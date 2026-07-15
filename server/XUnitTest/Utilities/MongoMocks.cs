using System.Collections.Generic;
using System.Linq;
using System.Threading;
using Blocks.Genesis;
using MongoDB.Bson;
using MongoDB.Driver;
using Moq;

namespace XUnitTest.Utilities
{
    /// <summary>
    /// Helpers to mock the MongoDB driver at the <see cref="IMongoCollection{T}"/> seam so that
    /// repository classes (which build queries with <c>Builders</c> and call
    /// <c>.Find(..).ToListAsync()/.FirstOrDefaultAsync()</c>) can be exercised without a real database.
    /// The LINQ-style Find extension methods ultimately funnel into <c>FindAsync</c>, which is the
    /// interface member we stub here.
    /// </summary>
    public static class MongoMocks
    {
        public static Mock<IAsyncCursor<T>> Cursor<T>(IEnumerable<T> items)
        {
            var list = items?.ToList() ?? new List<T>();
            var cursor = new Mock<IAsyncCursor<T>>();
            cursor.Setup(c => c.Current).Returns(list);
            cursor.SetupSequence(c => c.MoveNext(It.IsAny<CancellationToken>()))
                  .Returns(true)
                  .Returns(false);
            cursor.SetupSequence(c => c.MoveNextAsync(It.IsAny<CancellationToken>()))
                  .ReturnsAsync(true)
                  .ReturnsAsync(false);
            return cursor;
        }

        /// <summary>Creates a mock collection whose reads return <paramref name="data"/> and whose writes succeed.</summary>
        public static Mock<IMongoCollection<T>> Collection<T>(IEnumerable<T> data = null)
        {
            var coll = new Mock<IMongoCollection<T>>();

            coll.Setup(c => c.FindAsync(
                    It.IsAny<FilterDefinition<T>>(),
                    It.IsAny<FindOptions<T, T>>(),
                    It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => Cursor(data).Object);

            coll.Setup(c => c.InsertOneAsync(
                    It.IsAny<T>(),
                    It.IsAny<InsertOneOptions>(),
                    It.IsAny<CancellationToken>()))
                .Returns(Task.CompletedTask);

            coll.Setup(c => c.UpdateOneAsync(
                    It.IsAny<FilterDefinition<T>>(),
                    It.IsAny<UpdateDefinition<T>>(),
                    It.IsAny<UpdateOptions>(),
                    It.IsAny<CancellationToken>()))
                .ReturnsAsync(new UpdateResult.Acknowledged(1, 1, null));

            coll.Setup(c => c.DeleteOneAsync(
                    It.IsAny<FilterDefinition<T>>(),
                    It.IsAny<CancellationToken>()))
                .ReturnsAsync(new DeleteResult.Acknowledged(1));

            coll.Setup(c => c.ReplaceOneAsync(
                    It.IsAny<FilterDefinition<T>>(),
                    It.IsAny<T>(),
                    It.IsAny<ReplaceOptions>(),
                    It.IsAny<CancellationToken>()))
                .ReturnsAsync(new ReplaceOneResult.Acknowledged(1, 1, null));

            var count = data?.Count() ?? 0;
            coll.Setup(c => c.CountDocumentsAsync(
                    It.IsAny<FilterDefinition<T>>(),
                    It.IsAny<CountOptions>(),
                    It.IsAny<CancellationToken>()))
                .ReturnsAsync(count);

            return coll;
        }

        /// <summary>
        /// Builds an <see cref="IDbContextProvider"/> whose database returns the supplied mock collections
        /// keyed by document type. Any unmapped collection type resolves to an empty mock collection.
        /// </summary>
        public sealed class DbBuilder
        {
            private readonly Mock<IMongoDatabase> _db = new();
            private readonly Mock<IDbContextProvider> _provider = new();

            public DbBuilder()
            {
                _provider.Setup(p => p.GetDatabase(It.IsAny<string>(), It.IsAny<string>())).Returns(_db.Object);
                _provider.Setup(p => p.GetDatabase(It.IsAny<string>())).Returns(_db.Object);
                _provider.Setup(p => p.GetDatabase()).Returns(_db.Object);
            }

            public DbBuilder With<T>(Mock<IMongoCollection<T>> collection)
            {
                _db.Setup(d => d.GetCollection<T>(It.IsAny<string>(), It.IsAny<MongoCollectionSettings>()))
                   .Returns(collection.Object);
                return this;
            }

            public DbBuilder With<T>(IEnumerable<T> data)
            {
                return With(Collection(data));
            }

            public IDbContextProvider Provider => _provider.Object;
        }

        /// <summary>Adds a projected FindAsync setup (for <c>.Find(..).Project&lt;TProj&gt;(..)</c> queries).</summary>
        public static void SetupProjectedFind<TDoc, TProj>(Mock<IMongoCollection<TDoc>> coll, IEnumerable<TProj> items)
        {
            coll.Setup(c => c.FindAsync(
                    It.IsAny<FilterDefinition<TDoc>>(),
                    It.IsAny<FindOptions<TDoc, TProj>>(),
                    It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => Cursor(items).Object);
        }

        /// <summary>Stubs <c>AggregateAsync&lt;BsonDocument&gt;</c> so aggregation-pipeline response parsing can be tested.</summary>
        public static void SetupAggregate<TDoc>(Mock<IMongoCollection<TDoc>> coll, IEnumerable<BsonDocument> results)
        {
            var list = results.ToList();
            coll.Setup(c => c.AggregateAsync(
                    It.IsAny<PipelineDefinition<TDoc, BsonDocument>>(),
                    It.IsAny<AggregateOptions>(),
                    It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => Cursor(list).Object);
            // Fluent aggregate with an explicit pipeline executes via the synchronous Aggregate overload
            // (which still returns an async cursor).
            coll.Setup(c => c.Aggregate(
                    It.IsAny<PipelineDefinition<TDoc, BsonDocument>>(),
                    It.IsAny<AggregateOptions>(),
                    It.IsAny<CancellationToken>()))
                .Returns(() => Cursor(list).Object);
        }

        /// <summary>A collection whose reads throw, to exercise repository/service catch blocks.</summary>
        public static Mock<IMongoCollection<T>> CollectionThrowing<T>()
        {
            var coll = new Mock<IMongoCollection<T>>();
            coll.Setup(c => c.FindAsync(
                    It.IsAny<FilterDefinition<T>>(),
                    It.IsAny<FindOptions<T, T>>(),
                    It.IsAny<CancellationToken>()))
                .ThrowsAsync(new MongoException("boom"));
            return coll;
        }

        public static Mock<IBlocksSecret> BlocksSecret()
        {
            var secret = new Mock<IBlocksSecret>();
            secret.SetupGet(s => s.DatabaseConnectionString).Returns("mongodb://localhost/test");
            secret.SetupGet(s => s.RootDatabaseName).Returns("TestDb");
            return secret;
        }
    }
}
