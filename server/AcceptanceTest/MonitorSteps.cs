using System.Text.Json;
using Reqnroll;

namespace AcceptanceTest;

/// <summary>
/// Step definitions for Features/monitor.feature (approved by the owner 2026-11-21; the wording is not changed here).
/// The traceability block at the end of the feature file lists the endpoints each step uses.
/// A scenario cleans up after itself: it deletes the monitor it made (URLs must be unique) and empties Mailpit first.
/// </summary>
[Binding]
public sealed class MonitorSteps : IDisposable
{
    private static readonly TimeSpan Within = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan Poll = TimeSpan.FromSeconds(5);

    private readonly SelfhostClient _api = new(Settings.Load());
    private readonly List<string> _created = [];
    private string? _monitorId;
    private string? _name;
    private string? _url;
    private JsonElement _creation;

    public void Dispose() => _api.Dispose();

    // ---- helpers -------------------------------------------------------------------------------------------------------

    private static JsonElement? Prop(JsonElement e, string name)
    {
        if (e.ValueKind != JsonValueKind.Object)
        {
            return null;
        }
        foreach (var p in e.EnumerateObject())
        {
            if (string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase))
            {
                return p.Value;
            }
        }
        return null;
    }

    private static string Str(JsonElement e, string name) => Prop(e, name)?.ToString() ?? "";

    /// <summary>The array of items in a reply: data itself, or data.items / data.data.</summary>
    private static List<JsonElement> Items(JsonElement reply)
    {
        var data = Prop(reply, "data");
        if (data is null)
        {
            return [];
        }
        if (data.Value.ValueKind == JsonValueKind.Array)
        {
            return [.. data.Value.EnumerateArray()];
        }
        foreach (var n in new[] { "items", "data", "monitors", "incidents" })
        {
            var inner = Prop(data.Value, n);
            if (inner?.ValueKind == JsonValueKind.Array)
            {
                return [.. inner.Value.EnumerateArray()];
            }
        }
        return [];
    }

    private async Task<List<JsonElement>> MonitorsWithUrl(string url)
    {
        var reply = await _api.Monitor(HttpMethod.Get, "GetMonitorList", $"projectKey={_api.ProjectKey}&pageNumber=0&pageSize=30");
        return [.. Items(reply).Where(m => string.Equals(Str(m, "url"), url, StringComparison.OrdinalIgnoreCase))];
    }

    private async Task CreateMonitor(string name, string url)
    {
        _creation = await _api.Monitor(HttpMethod.Post, "SaveMonitor", body: new
        {
            projectKey = _api.ProjectKey,
            name,
            url,
            isActive = true,
            intervalInSeconds = 30,
            monitorType = "HTTP",
            protocolType = "HTTP",
            httpMethodType = "GET",
            monitorSourceType = "OtherServices",
        });
        _name = name;
        _url = url;
        if (Prop(_creation, "isSuccess")?.GetBoolean() == true)
        {
            _monitorId = Str(Prop(_creation, "data") ?? default, "itemId");
            if (_monitorId.Length > 0)
            {
                _created.Add(_monitorId);
            }
        }
    }

    private async Task WaitFor(Func<Task<bool>> condition, string what)
    {
        var deadline = DateTime.UtcNow + Within;
        while (true)
        {
            if (await condition())
            {
                return;
            }
            Assert.True(DateTime.UtcNow < deadline, $"within {Within.TotalMinutes} minutes: {what} did not happen");
            await Task.Delay(Poll);
        }
    }

    private async Task<List<JsonElement>> Incidents() =>
        Items(await _api.Monitor(HttpMethod.Get, "GetIncidentList", $"monitorId={_monitorId}&pageNumber=0&pageSize=10"));

    // ---- hooks ---------------------------------------------------------------------------------------------------------

    [BeforeScenario]
    public async Task EmptyMailpit() => await _api.Mailpit(HttpMethod.Delete, "/api/v1/messages");

    [AfterScenario]
    public async Task DeleteWhatTheScenarioCreated()
    {
        foreach (var id in _created)
        {
            await _api.Monitor(HttpMethod.Delete, "DeleteMonitor", $"itemId={id}");
        }
    }

    // ---- Background ----------------------------------------------------------------------------------------------------

    [Given("I am signed in as a user who can manage monitors in my project")]
    public async Task SignedIn()
    {
        await _api.SignIn();
        var reply = await _api.Monitor(HttpMethod.Get, "GetMonitorList", $"projectKey={_api.ProjectKey}&pageNumber=0&pageSize=1");
        Assert.True(Prop(reply, "isSuccess")?.GetBoolean() == true, "the signed-in user cannot read monitors: " + Str(reply, "message"));
    }

    [Given("my project has no monitor for {string}")]
    public async Task NoMonitorFor(string url)
    {
        // A monitor URL is unique across projects, so a leftover of an earlier run would refuse the creation: remove it.
        foreach (var m in await MonitorsWithUrl(url))
        {
            await _api.Monitor(HttpMethod.Delete, "DeleteMonitor", $"itemId={Str(m, "itemId")}");
        }
        Assert.Empty(await MonitorsWithUrl(url));
    }

    // ---- Scenario 1 ----------------------------------------------------------------------------------------------------

    [When("I create an active monitor named {string} for {string} that is checked every 30 seconds")]
    public async Task CreateActive(string name, string url) => await CreateMonitor(name, url);

    [Then("the creation is accepted")]
    public void CreationAccepted() =>
        Assert.True(Prop(_creation, "isSuccess")?.GetBoolean() == true, "SaveMonitor refused it: " + Str(_creation, "message"));

    [Then("my project's monitor list contains {string} with the address {string}")]
    public async Task ListContains(string name, string url)
    {
        var found = (await MonitorsWithUrl(url)).Where(m => Str(m, "name") == name).ToList();
        Assert.Single(found);
    }

    [Then("the monitor is shown as healthy and has no incidents")]
    public async Task HealthyNoIncidents()
    {
        var m = await _api.Monitor(HttpMethod.Get, "GetMonitorById", $"monitorId={_monitorId}");
        Assert.True(Prop(Prop(m, "data") ?? default, "currentStatus")?.GetBoolean() == true, "the monitor is not shown as healthy");
        Assert.Empty(await Incidents());
    }

    // ---- Scenarios 2 and 3 ---------------------------------------------------------------------------------------------

    [Given("an active monitor named {string} exists for {string}")]
    public async Task ActiveMonitorExists(string name, string url)
    {
        await CreateMonitor(name, url);
        CreationAccepted();
        Assert.False(string.IsNullOrEmpty(_monitorId), "SaveMonitor returned no item id");
    }

    [Given("{string} is an alert recipient for that monitor")]
    public async Task AlertRecipient(string email)
    {
        var reply = await _api.Monitor(HttpMethod.Post, "SaveAlertRecipient", body: new
        {
            projectKey = _api.ProjectKey,
            email,
            allMonitors = false,
            monitorIds = new[] { _monitorId },
        });
        Assert.True(Prop(reply, "isSuccess")?.GetBoolean() == true, "SaveAlertRecipient refused it: " + Str(reply, "message"));
    }

    [When("the monitor's next check runs and the target cannot be reached")]
    public void NextCheckRuns()
    {
        // Nothing to trigger: the worker checks after the interval, and a ".test" name never resolves.
        // The Then steps wait up to two minutes for the result.
    }

    [Then("within 2 minutes the monitor has one open incident")]
    public async Task OneOpenIncident()
    {
        await WaitFor(async () => (await Incidents()).Count > 0, "an incident opening");
        var open = (await Incidents()).Where(i => Prop(i, "isResolved")?.GetBoolean() == false).ToList();
        Assert.Single(open);
    }

    [Then("the incident names the address {string} and is not resolved")]
    public async Task IncidentNamesAddress(string url)
    {
        var incident = Assert.Single(await Incidents());
        Assert.Equal(url, Str(incident, "monitorUrl"), ignoreCase: true);
        Assert.False(Prop(incident, "isResolved")?.GetBoolean());
    }

    [Then("the monitor is shown as down")]
    public async Task ShownAsDown()
    {
        var m = await _api.Monitor(HttpMethod.Get, "GetMonitorById", $"monitorId={_monitorId}");
        Assert.True(Prop(Prop(m, "data") ?? default, "currentStatus")?.GetBoolean() == false, "the monitor is not shown as down");
    }

    [Then("within 2 minutes one alert email is delivered to {string}")]
    public async Task OneEmailDelivered(string email)
    {
        try
        {
            await WaitFor(async () => Messages(await _api.Mailpit(HttpMethod.Get, $"/api/v1/search?query=to:{Uri.EscapeDataString(email)}")).Count > 0, "an alert email arriving");
        }
        catch (Exception ex)
        {
            // What the service knows about this monitor and its people (no password or token), to tell a missing recipient from a mail failure.
            var monitor = await _api.Monitor(HttpMethod.Get, "GetMonitorById", $"monitorId={_monitorId}");
            var people = await _api.Monitor(HttpMethod.Get, "GetAlertRecipients", $"projectKey={_api.ProjectKey}");
            throw new InvalidOperationException($"{ex.Message}. DIAGNOSTIC monitor: {monitor} DIAGNOSTIC recipients: {people}", ex);
        }
        // Mailpit was emptied at the start of the scenario, so every message found is new. Wait a moment for a duplicate.
        await Task.Delay(TimeSpan.FromSeconds(10));
        Assert.Single(Messages(await _api.Mailpit(HttpMethod.Get, $"/api/v1/search?query=to:{Uri.EscapeDataString(email)}")));
    }

    [Then("the email names the monitor {string} and the address {string}")]
    public async Task EmailNames(string name, string url)
    {
        var found = Messages(await _api.Mailpit(HttpMethod.Get, "/api/v1/messages"));
        var id = Assert.Single(found).GetProperty("ID").GetString();
        var message = await _api.Mailpit(HttpMethod.Get, $"/api/v1/message/{id}");
        var text = Str(message, "Subject") + " " + Str(message, "Text") + " " + Str(message, "HTML");
        Assert.Contains(name, text);
        Assert.Contains(url, text);
    }

    private static List<JsonElement> Messages(JsonElement reply)
    {
        var m = Prop(reply, "messages");
        return m?.ValueKind == JsonValueKind.Array ? [.. m.Value.EnumerateArray()] : [];
    }
}
