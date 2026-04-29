using System.Net;
using System.Text;
using System.Text.Json;
using Blocks.Genesis;
using Devops.DomainService.Shared.Interfaces;
using Microsoft.Extensions.Logging;

namespace Devops.DomainService.Shared.Services
{
    public class HttpHelperServices : IHttpHelperServices
    {
        private readonly ILogger<HttpHelperServices> _logger;
        private readonly IHttpService _httpService;
        private readonly IHttpClientFactory _httpClientFactory;

        public HttpHelperServices(IHttpService httpService, IHttpClientFactory httpClientFactory, ILogger<HttpHelperServices> logger)
        {
            _logger = logger;
            _httpService = httpService;
            _httpClientFactory = httpClientFactory;
        }

        private HttpClient BuildHttpClient(string clientName, string? token, Dictionary<string, string>? headers)
        {
            var client = _httpClientFactory.CreateClient(clientName);
            if (!string.IsNullOrEmpty(token))
                client.DefaultRequestHeaders.Authorization =
                    new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            if (headers != null)
                foreach (var header in headers)
                    client.DefaultRequestHeaders.TryAddWithoutValidation(header.Key, header.Value);
            return client;
        }

        private static StringContent BuildJsonContent(object payload)
        {
            var json = JsonSerializer.Serialize(payload);
            return new StringContent(json, Encoding.UTF8, "application/json");
        }


        public async Task<(T?, HttpResponseMessage Response)> MakeHttpRequest<T>(string clientName, string url,
                            HttpMethod method, object? payload = null, Dictionary<string, string>? headers = null,
                            string? token = null) where T : class
        {
            try
            {
                var client = BuildHttpClient(clientName, token, headers);
                var request = new HttpRequestMessage(method, url);

                if ((method == HttpMethod.Post || method == HttpMethod.Put || method == HttpMethod.Patch) && payload != null)
                    request.Content = BuildJsonContent(payload);

                HttpResponseMessage response;

                try
                {
                    response = await client.SendAsync(request);
                }
                catch (HttpRequestException ex)
                {
                    var unreachableResponse = new HttpResponseMessage
                    {
                        StatusCode = 0,
                        ReasonPhrase = "Unreachable"
                    };
                    return (null, unreachableResponse);
                }
                catch (TaskCanceledException ex)
                {
                    var timeoutResponse = new HttpResponseMessage
                    {
                        StatusCode = HttpStatusCode.RequestTimeout,
                        ReasonPhrase = "Timeout"
                    };
                    return (null, timeoutResponse);
                }

                if (method == HttpMethod.Head)
                {
                    return (null, response);
                }

                var contentString = await response.Content.ReadAsStringAsync();

                // Explicit handling for 503 Service Unavailable
                if (response.StatusCode == HttpStatusCode.ServiceUnavailable)
                {
                    _logger.LogWarning("Service Unavailable (503): {Url}", url);
                }

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError("Request failed with status code: {StatusCode}, Body: {Body}", response.StatusCode, contentString);
                    try
                    {
                        var result = JsonSerializer.Deserialize<T>(contentString);
                        return (result, response);
                    }
                    catch (JsonException)
                    {
                        return (null, response);
                    }
                }

                try
                {
                    var deserialized = JsonSerializer.Deserialize<T>(contentString);
                    return (deserialized, response);
                }
                catch
                {
                    return (null, response);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError("Unexpected error making {Method} request to: {Url}, Exception: {Exception}", method.Method, url, ex.Message);
                return (null, new HttpResponseMessage
                {
                    StatusCode = 0,
                    ReasonPhrase = "UnexpectedError"
                });
            }
        }

        public async Task<(T?, string)> MakeHttpGetRequest<T>(string url, string token = null, Dictionary<string, string> headers = null) where T : class
        {
            try
            {
                _logger.LogInformation("Making GET request to: {Url}", url);
                var (data, rawResponse) = await _httpService.Get<T>(url, headers);
                return (data, rawResponse);
            }
            catch (Exception ex)
            {
                _logger.LogError("Error making GET request to: {Url} ", url, ex.Message);
                return (null, "Operation Failed.");
            }
        }

        public async Task<(T?, string)> MakeHttpPostRequest<T>(object payload, string url, Dictionary<string, string> headers = null, string token = null, string contentType = "application/json") where T : class
        {
            try
            {
                var (data, rawResponse) = await _httpService.Post<T>(payload, url, contentType, headers);

                return (data, rawResponse);
            }
            catch (Exception ex)
            {
                _logger.LogError("Error making POST request to: {Url}", url);
                return (null, "Operation Failed.");
            }
        }


        public async Task<(T?, HttpResponseMessage Response)> MakeHttpDeleteRequest<T>(string clientName, string url, HttpMethod method, object? payload = null, Dictionary<string, string>? headers = null, string? token = null) where T : class
        {
            try
            {
                _logger.LogInformation("Making {Method} request to: {Url}", method.Method, url);

                var client = BuildHttpClient(clientName, token, headers);
                var request = new HttpRequestMessage(method, url);

                if (method == HttpMethod.Delete && payload != null)
                    request.Content = BuildJsonContent(payload);

                var response = await client.SendAsync(request);

                var contentString = await response.Content.ReadAsStringAsync();

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError("Request failed with status code: {StatusCode}, Body: {Body}", response.StatusCode, contentString);
                }

                var deserialized = JsonSerializer.Deserialize<T>(contentString);
                return (deserialized, response);
            }
            catch (Exception ex)
            {
                _logger.LogError("Error making {Method} request to: {Url}, Exception: {Exception}", method.Method, url, ex.Message);
                return (null, new HttpResponseMessage());
            }
        }

        public async Task<(T? data, E? error, HttpResponseMessage Response)> MakeHttpRequest<T, E>(string clientName, string url, HttpMethod method,  object? payload = null, Dictionary<string, string>? headers = null, string? token = null)
        where T : class
        where E : class
        {
            try
            {
                _logger.LogInformation("Making {Method} request to: {Url}", method.Method, url);

                var client = BuildHttpClient(clientName, token, headers);
                var request = new HttpRequestMessage(method, url);

                if ((method == HttpMethod.Post || method == HttpMethod.Put || method == HttpMethod.Patch) && payload != null)
                    request.Content = BuildJsonContent(payload);

                var response = await client.SendAsync(request);
                var contentString = await response.Content.ReadAsStringAsync();

                var jsonOptions = new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                };

                if (response.IsSuccessStatusCode)
                {
                    _logger.LogInformation("Request succeeded with status code: {StatusCode}", response.StatusCode);
                    var successData = JsonSerializer.Deserialize<T>(contentString, jsonOptions);
                    return (successData, null, response);
                }
                else
                {
                    _logger.LogError("Request failed with status code: {StatusCode}, Body: {Body}", response.StatusCode, contentString);
                    var errorData = JsonSerializer.Deserialize<E>(contentString, jsonOptions);
                    return (null, errorData, response);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError("Error making {Method} request to: {Url}, Exception: {Exception}", method.Method, url, ex);
                return (null, null, new HttpResponseMessage());
            }
        }
    }
}
