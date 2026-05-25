namespace DomainService.Monitor.Services
{
    public class MonitorQueueManager : IMonitorQueueManager
    {
        private readonly SortedSet<MonitorQueueTask> _taskQueue;
        private readonly object _lock = new object();

        public MonitorQueueManager()
        {
            _taskQueue = new SortedSet<MonitorQueueTask>(Comparer<MonitorQueueTask>.Create(
                (a, b) => a.NextExecutionTime == b.NextExecutionTime
                          ? a.Config.ItemId.CompareTo(b.Config.ItemId)
                          : a.NextExecutionTime.CompareTo(b.NextExecutionTime)
            ));
        }

        private T WithLock<T>(Func<T> action) { lock (_lock) return action(); }
        private void WithLock(Action action) { lock (_lock) action(); }
        private MonitorQueueTask PeekInternal() => _taskQueue.FirstOrDefault();
        private void RemoveInternal(MonitorQueueTask task) => _taskQueue.Remove(task);

        public void Enqueue(MonitorQueueTask task) => WithLock(() => _taskQueue.Add(task));

        public MonitorQueueTask Peek() => WithLock(PeekInternal);

        public MonitorQueueTask Dequeue() => WithLock(() =>
        {
            var task = PeekInternal();
            if (task != null)
                RemoveInternal(task);
            return task;
        });

        public bool HasTasks() => WithLock(() => _taskQueue.Count > 0);

        public void RemoveByItemId(string itemId) => WithLock(() =>
        {
            var taskToRemove = _taskQueue.FirstOrDefault(t => t.Config.ItemId == itemId);
            if (taskToRemove != null)
                RemoveInternal(taskToRemove);
        });

        public IEnumerable<MonitorQueueTask> GetAll() => _taskQueue.ToList();

    }
}
