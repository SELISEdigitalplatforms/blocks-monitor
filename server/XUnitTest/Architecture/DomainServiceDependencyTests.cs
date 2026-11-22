using System.Reflection;
using Api.Controllers;
using DomainService.AlertRecipients.Services;
using FluentAssertions;

namespace XUnitTest.Architecture;

// I04-WP8 step 4: no type in a *.DomainService assembly depends on the Api or Worker assembly.
// The plan named NetArchTest.Rules for this. It is not added: its newest release (1.3.2) is from 2021-05-23, which
// fails the 24-month rule of A5, so it would need the owner's APPROVE. The same rule is checked here with reflection.
public class DomainServiceDependencyTests
{
    private static readonly string[] ForbiddenAssemblyNames = { "Api", "Worker" };

    [Fact]
    public void NoDomainServiceType_DependsOnTheApiOrWorkerAssembly()
    {
        var domainService = typeof(AlertRecipientService).Assembly;
        domainService.GetName().Name.Should().Be("Alert.DomainService");

        var violations = FindViolations(domainService);

        violations.Should().BeEmpty("a DomainService type must not reference the Api or Worker assembly");
    }

    [Fact]
    public void TheDetector_FlagsATypeThatDependsOnTheApiAssembly()
    {
        // Proves the detector sees a dependency: the probe names an Api type in a property signature.
        // A property yields one entry for each accessor signature, so check the set, not a count.
        var violations = ViolationsOf(typeof(DependencyProbe)).ToList();

        violations.Should().NotBeEmpty();
        violations.Should().OnlyContain(v => v.EndsWith("(Api)"));
    }

    private static List<string> FindViolations(Assembly assembly)
    {
        Type[] types;
        try
        {
            types = assembly.GetTypes();
        }
        catch (ReflectionTypeLoadException ex)
        {
            types = ex.Types.Where(t => t is not null).Select(t => t!).ToArray();
        }

        return types.SelectMany(ViolationsOf).ToList();
    }

    private static IEnumerable<string> ViolationsOf(Type type)
    {
        foreach (var referenced in ReferencedTypes(type))
        {
            var assemblyName = referenced.Assembly.GetName().Name;
            if (ForbiddenAssemblyNames.Contains(assemblyName))
            {
                yield return $"{type.FullName} -> {referenced.FullName} ({assemblyName})";
            }
        }
    }

    private static IEnumerable<Type> ReferencedTypes(Type type)
    {
        const BindingFlags all = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance
                                 | BindingFlags.Static | BindingFlags.DeclaredOnly;

        var found = new List<Type>();
        if (type.BaseType is not null)
        {
            found.Add(type.BaseType);
        }

        found.AddRange(type.GetInterfaces());
        found.AddRange(type.GetFields(all).Select(f => f.FieldType));
        found.AddRange(type.GetProperties(all).Select(p => p.PropertyType));
        foreach (var method in type.GetMethods(all))
        {
            found.Add(method.ReturnType);
            found.AddRange(method.GetParameters().Select(p => p.ParameterType));
        }

        foreach (var ctor in type.GetConstructors(all))
        {
            found.AddRange(ctor.GetParameters().Select(p => p.ParameterType));
        }

        return found.SelectMany(Expand);
    }

    // Arrays, references and generic arguments hide the real assembly, so each one is checked too.
    private static IEnumerable<Type> Expand(Type type)
    {
        if (type.HasElementType)
        {
            foreach (var inner in Expand(type.GetElementType()!))
            {
                yield return inner;
            }

            yield break;
        }

        yield return type;

        if (type.IsGenericType)
        {
            foreach (var argument in type.GetGenericArguments())
            {
                foreach (var inner in Expand(argument))
                {
                    yield return inner;
                }
            }
        }
    }
}

// Probe for the detector only. It is never used by the product.
public sealed class DependencyProbe
{
    public MonitorController Controller { get; set; } = null!;
}
