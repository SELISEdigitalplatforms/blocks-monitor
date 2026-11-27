# APPROVED by the owner on 2026-11-21 (decision pack S3, work package I04-WP7). Change a scenario only with the owner's approval.
# Drafted 2026-11-21 from src\blocks-monitor trunk 55ad53a.

Feature: Monitoring a web target and alerting people when it fails
  A project owner watches a web address. When the address cannot be reached,
  an incident is recorded and the people chosen as alert recipients get an email.

  Background:
    Given I am signed in as a user who can manage monitors in my project
    And my project has no monitor for "http://unreachable.blocks.test"

  Scenario: A user creates a monitor
    When I create an active monitor named "Unreachable demo" for "http://unreachable.blocks.test" that is checked every 30 seconds
    Then the creation is accepted
    And my project's monitor list contains "Unreachable demo" with the address "http://unreachable.blocks.test"
    And the monitor is shown as healthy and has no incidents

  Scenario: An incident opens when the monitored target fails
    Given an active monitor named "Unreachable demo" exists for "http://unreachable.blocks.test"
    When the monitor's next check runs and the target cannot be reached
    Then within 2 minutes the monitor has one open incident
    And the incident names the address "http://unreachable.blocks.test" and is not resolved
    And the monitor is shown as down

  Scenario: An alert recipient is notified when an incident opens
    Given an active monitor named "Unreachable demo" exists for "http://unreachable.blocks.test"
    And "alerts@example.test" is an alert recipient for that monitor
    When the monitor's next check runs and the target cannot be reached
    Then within 2 minutes one alert email is delivered to "alerts@example.test"
    And the email names the monitor "Unreachable demo" and the address "http://unreachable.blocks.test"

# ---------------------------------------------------------------------------
# TRACEABILITY: what each step relies on (all paths relative to src\blocks-monitor\server)
# Base route of every endpoint: /api/Monitor/<Action> (MonitorController, Api\Controllers\MonitorController.cs).
# The reply envelope is BaseApiResponse { isSuccess, message, data } (PaginatedResponse for lists).
# ---------------------------------------------------------------------------
#
# Background
#  - "signed in ... can manage monitors": the endpoints below need the permissions
#    blocks-monitor::monitor::manage (create, save recipient) and blocks-monitor::monitor::read
#    ([ProtectedEndPoint] in Api\Controllers\MonitorController.cs). The project key is the tenant id; a recipient
#    request for another project is refused with "Project not found." (AlertRecipientService.ResolveTenant).
#  - "no monitor for that address": GET GetMonitorList?projectKey=... (MonitorController.GetMonitorList). The
#    creation check SaveMonitorConfigurationRequestValidator.BeUniqueUrl refuses a second monitor with the same URL
#    ("A monitor with this URL already exists."); see open point 3.
#
# Scenario 1 (create)
#  - "I create an active monitor ... every 30 seconds": POST SaveMonitor, body SaveMonitorConfigurationRequest
#    (Alert.DomainService\Monitor\Models\SaveMonitorConfigurationRequest.cs): projectKey, name, url, isActive=true,
#    intervalInSeconds=30, monitorType "HTTP", protocolType "HTTP", httpMethodType "GET", monitorSourceType
#    "OtherServices". Rules: SaveMonitorConfigurationRequestValidator.cs (name and URL required, http/https only,
#    unique URL, at most 30 monitors per project). Handler: MonitorConfigurationService.SaveConfigurationAsync.
#  - "creation is accepted": response isSuccess=true, message "MonitorConfiguration with ItemId <id> created
#    successfully.", data = the new monitor (itemId, currentStatus=true). MonitorConfigurationService sends a
#    MonitorConfigurationUpdateQueue message so the worker loads the monitor (see scenario 2).
#  - "monitor list contains": GET GetMonitorList?projectKey=...&pageNumber=0&pageSize=10 (data[].name, data[].url);
#    or GET GetMonitorById?monitorId=<id> (data.url, data.currentStatus).
#  - "healthy and has no incidents": data.currentStatus is true by default (MonitorConfiguration.CurrentStatus,
#    src\blocks-genesis-net\src\Genesis\Entities\Monitor\MonitorConfiguration.cs); GET GetIncidentList?monitorId=<id>
#    returns totalCount 0 (MonitorIncidentService.GetIncidentsByMonitorIdAsync).
#
# Scenario 2 (incident opens)
#  - "an active monitor exists" (Given): the same SaveMonitor call as scenario 1.
#  - "next check runs and the target cannot be reached": the worker, not the API, does this.
#    Worker\Consumers\MonitorSchedulerBackgroundWorker.cs starts MonitorSchedulerService
#    (Alert.DomainService\Monitor\MonitorSchedulingService\MonitorSchedulerService.cs). A new monitor is loaded when
#    the consumer Worker\Consumers\MonitorConfigurationUpdateConsumer.cs receives the message from SaveMonitor (or
#    at the latest at the 600 s database poll). A monitor is queued to run IntervalInSeconds after it is loaded
#    (MonitorQueueTask.cs), then re-queued after every run. Only IsActive monitors of type OutboundPing are loaded
#    (MonitorConfigurationRepoService.GetAllConfigurationListAsync).
#    The check is MonitorPingService.MonitorPingAsync -> HttpHelperServices.MakeHttpRequest. A name that does not
#    resolve raises HttpRequestException, which becomes status code 0 and reason "Unreachable"; a timeout becomes 408.
#    Nothing in the test needs to trigger the check: the target is simply unreachable (".test" never resolves).
#  - "within 2 minutes the monitor has one open incident": MonitorIncidentService.HandleIncidentAsync
#    (Alert.DomainService\Monitor\MonitorIncidentService\MonitorIncidentService.cs). A check is a failure when the
#    status code is below 200 or 400 and above. There is NO consecutive-failure threshold: the first failed check
#    opens an incident, and later failed checks do not open another while it is open. Read with
#    GET GetIncidentList?monitorId=<id>&pageNumber=0&pageSize=10 (data[]: isResolved=false, monitorUrl,
#    monitorName, lastStatusCode=0, failureReason "Unreachable", startTime, endTime null).
#    Poll that endpoint (for example every 5 s, up to 120 s); expected arrival is about 30 s to 40 s after creation.
#  - "shown as down": GET GetMonitorById -> data.currentStatus=false (set by UpdateConfigurationIncidentAsync in the
#    same HandleIncidentAsync call).
#
# Scenario 3 (recipient notified)
#  - "is an alert recipient for that monitor": POST SaveAlertRecipient, body SaveAlertRecipientRequest
#    (Alert.DomainService\AlertRecipients\Models\SaveAlertRecipientRequest.cs): projectKey, email
#    "alerts@example.test", allMonitors=false, monitorIds=[<monitor id>]. Result data = AlertRecipientChangeResult
#    (added=1). Check with GET GetAlertRecipients?projectKey=... (data.recipients[].email, monitorIds). Rules:
#    Alert.DomainService/Validators/SaveAlertRecipientRequestValidator.cs and AlertRecipientRules.cs (valid email, at most 10 per monitor).
#    The monitor's own create request cannot carry emails (they are ignored; SaveMonitorConfigurationRequest.cs),
#    so the recipient step must come after the monitor exists. The email sent goes to MonitorConfiguration.Emails.
#  - "one alert email is delivered": on a new incident HandleIncidentAsync calls EmailAlertService.HandleEmailAlertAsync
#    (Alert.DomainService\Alert\Services\EmailAlertService.cs): it reads the "AlertIncident" email template and its
#    mail server configuration from the ROOT database (AlertRepoService.cs), then sends one message per address in
#    monitor.Emails over SMTP (MailKit when SmtpClient == 0). Observed from outside through Mailpit's HTTP API
#    (GET /api/v1/search?query=to:alerts@example.test, or GET /api/v1/messages): one message with that To address.
#    Mailpit web UI is on http://127.0.0.1:8025 (blocks-infra\docker-compose.local.yml, service "mailpit").
#  - "names the monitor and the address": the template fills {{MonitorName}}, {{MonitorUrl}}, {{StatusCode}},
#    {{FailureReason}}, {{DetectedAt}} (EmailAlertService.BuildVariables). Whether the stored "AlertIncident"
#    template actually prints name and URL depends on the template content in the database; see open point 2.
#  - Not observable and so not asserted: HandleIncidentAsync also sends an in-app notification
#    (NotificationAlertService.cs, POST to the configured NotificationServiceUrl). The result is only logged.
#
# ---------------------------------------------------------------------------
# OPEN POINTS FOR THE OWNER
# ---------------------------------------------------------------------------
# 1. Waiting. The shortest interval the screen offers is 30 seconds (client\app\constants\alert.constant.ts offers
#    30 s, 1 m, 5 m, 30 m, 1 h). The API checks no minimum, so a test could send a smaller value, but that would test a
#    path no user can take. The draft uses 30 s, so scenarios 2 and 3 each take about 30 to 60 s. The default interval
#    in the entity is also 30 s. Proposed time limit: 2 minutes. There is no way to trigger a check on demand
#    (no "check now" endpoint), and the worker only checks after the interval has passed.
# 2. Mail needs seed data that I could not confirm. Scenario 3 only works if the root database holds an email template
#    named "AlertIncident" and a mail server configuration pointing at Mailpit (SMTP, plain, any login), and if the
#    Worker container is running. I found Mailpit in the local compose files but no template named "AlertIncident" in
#    the seed folders I looked at (blocks-infra\seed, BlocksRootDb, init-mongo.js, local-setup). If the template is
#    missing, EmailAlertService only logs "Mail template AlertIncident not found" and no mail is sent. The executor
#    should check this first. The wording checked in the email (name, address) must also be agreed once the template
#    is known.
# 3. Repeatable runs. A monitor URL must be unique (the check looks the URL up across all monitors, not only the
#    project), and a project holds at most 30. "http://unreachable.blocks.test" will be refused the second time unless
#    the test deletes its monitor at the end (DELETE DeleteMonitor?itemId=<id>, permission manage) or uses a unique
#    host such as "http://run-<id>.unreachable.blocks.test". The Background's "no monitor for that address" assumes
#    one of these. Also empty Mailpit's messages for the recipient before scenario 3 (DELETE /api/v1/messages), or
#    count only messages that arrive after the monitor was created.
# 4. A failed check is any answer outside 200 to 399, or no answer. There is no setting for "fail after N failures":
#    one failed check opens an incident and sends the email at once. Likewise there is one email when the incident
#    opens and one more when it resolves (template "AlertResolved"); resolving is not part of these three scenarios.
#    The fields successHttpResponseCodes, expectedContent and timeoutInSeconds are stored but I found no code that uses
#    them in the check (MonitorPingService / HandleIncidentAsync only look at the status code), so they are left out.
# 5. Incident and notification are written in one process step but through separate stores; the email is sent together
#    with the incident row. If SMTP fails the incident still exists, which is why scenarios 2 and 3 are separate.
# 6. The in-app notification (see the end of scenario 3's notes) cannot be seen from outside and has no scenario.
#    Proposed: leave it to a unit test (NotificationAlertServiceTests already exist).
# 7. Mailing "All monitors" recipients: a recipient saved with allMonitors=true is copied to monitors created later
#    (AlertRecipientStore.GetEmailsForNewMonitorAsync). The draft uses a per-monitor recipient so the scenario does not
#    depend on other recipients already in the project.
