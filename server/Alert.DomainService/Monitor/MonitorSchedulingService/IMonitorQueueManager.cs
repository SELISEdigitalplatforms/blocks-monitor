
namespace DomainService.Monitor.Services
{
    public interface IMonitorQueueManager
    {
        void Enqueue(MonitorQueueTask task);
        MonitorQueueTask? Peek();
        MonitorQueueTask? Dequeue();
        bool HasTasks();
        void RemoveByItemId(string itemId);
        IEnumerable<MonitorQueueTask> GetAll();
    }
}
