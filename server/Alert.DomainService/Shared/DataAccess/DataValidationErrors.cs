using System.Net;
using Blocks.Genesis.DataAccess.Rules;
using DomainService.Shared.Models;

namespace DomainService.Shared.DataAccess;

/// <summary>
/// A refused save as <c>BaseResponse.Errors</c>: one message per property, the field's path as key. Same shape as
/// the Api's DataValidationExceptionFilter, for service methods that return their failure instead of throwing.
/// </summary>
public static class DataValidationErrors
{
    public static Dictionary<string, string> ToErrors(this DataValidationException exception)
    {
        ArgumentNullException.ThrowIfNull(exception);
        var errors = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var error in exception.Result.Errors)
            errors[error.FieldName] = errors.TryGetValue(error.FieldName, out var earlier) ? $"{earlier}; {error.Message}" : error.Message;
        return errors;
    }

    /// <summary>The services' failure response for a save the validation rules refused: 400, one message per property.</summary>
    public static BaseApiResponse ToRefusedResponse(this DataValidationException exception)
    {
        ArgumentNullException.ThrowIfNull(exception);
        return new BaseApiResponse
        {
            IsSuccess = false,
            StatusCode = HttpStatusCode.BadRequest,
            Message = exception.Message,
            Errors = exception.ToErrors(),
        };
    }
}
