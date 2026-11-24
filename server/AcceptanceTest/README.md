# Acceptance tests (Gherkin)

Three scenarios in `Features/monitor.feature` (create a monitor; an incident opens when the target fails; an alert
recipient is emailed). They call a **running blocks-selfhost** project over HTTP and never touch the main stack.
Reqnroll with xUnit v3; step definitions in `MonitorSteps.cs`, HTTP and sign-in in `SelfhostClient.cs`.

The scenarios were approved by the owner; change one only with the owner's approval. `Features/monitor.feature` is a copy of
`acceptance\blocks-monitor\monitor.feature` of the workspace.

## Run

1. `BLOCKS_PROFILES=mail` and `selfhost\blocks.ps1 up -WithTestFixtures` (seeds the test users, Mailpit, and the `AlertIncident`
   mail template; the monitor worker must run).
2. `selfhost\new-acceptance-settings.ps1` writes `acceptance.settings.json` here (git-excluded).
3. `local-setup\blocks.ps1 test dotnet <this repository folder> server\AcceptanceTest\AcceptanceTest.csproj`

Checks run at most every 30 s, so scenarios 2 and 3 take about one to two minutes each. Stopping `monitor-api` makes them fail.
Without `acceptance.settings.json` every scenario fails with a message; nothing is skipped.

Not in `Blocks.slnx`, so `dotnet test` of the solution does not need the stack. Dependencies: Reqnroll.xunit.v3 (BSD-3-Clause),
xunit.v3 (Apache-2.0).
