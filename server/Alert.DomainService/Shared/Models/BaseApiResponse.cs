using System.Net;
using Blocks.Genesis;

namespace DomainService.Shared.Models
{
    public class BaseApiResponse : BaseResponse
    {
        public object Data { get; set; }
        public string Message { get; set; }
        public HttpStatusCode StatusCode { get; set; }
    }
}
