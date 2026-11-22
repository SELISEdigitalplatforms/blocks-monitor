// Lindenhof Treuhand AG · Payroll Self-Service, at Requirements (sanitization completed two days ago; the design
// brief is still a draft with sample files; MADP suggestions and a discussion on a requirement are open). Greenfield.
import type { ProjectPlan } from "../../model";

const CLAUDIA: [string, string] = ["Claudia Imhof", "claudia.imhof@lindenhof-treuhand.ch"];
const ELENA: [string, string] = ["Elena Frei", "elena.frei@selisegroup.com"];

export const PAYROLL: ProjectPlan = {
  key: "payroll-self-service",
  workspace: "lindenhof",
  name: "Payroll Self-Service",
  client: { name: "Lindenhof Treuhand AG", contact: "Claudia Imhof", industry: "Fiduciary and accounting", region: "Lucerne, Switzerland" },
  brief: "Lindenhof runs payroll for 120 small companies. Employees of those companies should see their payslips and salary statements online, and employers should report hours, absences and changes without e-mailing spreadsheets.",
  stage: "requirements",
  repo: { mode: "new" },
  creator: "elena",
  assignee: "elena",
  lead: "elena",
  handedOverBy: "reto",
  days: { created: "-16d@09:30", handedOver: "-12d@14:00", sanitized: "-2d@15:30", updated: "-0d@09:10" },
  docs: {
    folders: [
      { key: "meetings", name: "Meetings", kind: "meeting", at: "-16d@09:35", by: "elena" },
      { key: "payroll-today", name: "Payroll today", kind: "other", at: "-16d@09:36", by: "elena" },
      { key: "ideas", name: "Ideas from the team", kind: "ideation", at: "-15d@11:00", by: "beat" },
    ],
    scratch: { body: "- 120 client companies, 1'450 employees on payroll\n- Payroll run on the 20th, payslips by e-mail as PDF today\n- Employers send hours as Excel by the 15th\n- Languages: German, some employers want French", at: "-16d@10:00", by: "elena" },
    notes: [
      {
        key: "kickoff",
        folder: "meetings",
        title: "Kick-off payroll self-service",
        body: "Kick-off · Claudia Imhof, Beat Zimmermann, Reto Arnold, Elena Frei\n\n- Payroll team (3 people) spends 4 days a month collecting hours and absences from employers.\n- About 30 employers send their data late or incomplete every month.\n- Employees call to ask for copies of payslips and salary statements, especially in February.\n- Wish: employers enter hours and absences in a form; employees download their documents.\n- Payroll calculation stays in the existing payroll software; the portal only collects and publishes.\n- Data protection: salary data is sensitive, access per company and per employee.",
        at: "-15d@10:30",
        by: "elena",
      },
      {
        key: "monthly-cycle",
        folder: "payroll-today",
        title: "How a payroll month runs today",
        body: "1. By the 15th: employers e-mail hours, absences, new hires and leavers (Excel, sometimes photos of paper)\n2. 16th-18th: payroll team checks and types everything into the payroll software\n3. 20th: payroll run, payslips as PDF\n4. 21st: payslips e-mailed to employers, who forward them to employees\n5. January: salary statements for the tax return\n\nPain points: late data, typing errors, employees without e-mail.",
        at: "-14d@16:00",
        by: "elena",
      },
      {
        key: "beat-ideas",
        folder: "ideas",
        title: "Ideas from Beat",
        body: "- Reminder to employers on the 12th if nothing was entered yet\n- Employees could see their remaining holidays\n- Import from the time-tracking tools some employers already use (CSV)",
        at: "-13d@08:50",
        by: "beat",
      },
    ],
    files: [
      {
        key: "hours-template",
        folder: "payroll-today",
        at: "-14d@16:10",
        by: "elena",
        file: {
          type: "text",
          name: "Hours and absences template October.csv",
          mime: "text/csv",
          text: "Employee no.;Name;Hours;Overtime;Holiday days;Sick days;Remarks\r\n1001;Sabine Kaufmann;168;4;0;0;\r\n1002;Luca Moretti;142;0;2;1;doctor's note follows\r\n1003;Petra Albrecht;84;0;0;0;part-time 50%\r\n",
        },
      },
      {
        key: "payslip",
        folder: "payroll-today",
        at: "-14d@16:15",
        by: "elena",
        file: {
          type: "pdf",
          name: "Payslip layout (anonymised).pdf",
          issued: "-35d",
          issuer: "Lindenhof Treuhand AG · Payroll services",
          color: "7a4b2a",
          title: "Payslip September",
          subtitle: "Layout as sent today, personal data removed",
          meta: [["Employer", "Company 4412"], ["Employee", "Employee 1002"], ["Period", "September"]],
          sections: [
            { heading: "Salary", table: { head: ["Item", "Rate", "CHF"], widths: [0.6, 0.2, 0.2], rows: [["Monthly salary", "", "6'200.00"], ["Overtime 4 h", "41.20", "164.80"], ["Gross salary", "", "6'364.80"], ["AHV/IV/EO", "5.30%", "-337.35"], ["ALV", "1.10%", "-70.01"], ["Pension fund", "", "-412.50"], ["Net salary", "", "5'544.94"]] } },
          ],
        },
      },
      {
        key: "claudia-mail",
        folder: "meetings",
        at: "-13d@09:40",
        by: "elena",
        file: {
          type: "eml",
          name: "Employees without e-mail.eml",
          from: CLAUDIA,
          to: [ELENA],
          at: "-13d@09:05",
          subject: "Employees without e-mail",
          body: "Hello Ms Frei\n\nOne point from yesterday: about 15% of the employees have no e-mail address, mostly in construction and cleaning companies. Their payslips go on paper to the employer today.\n\nWe would like them to be able to use the portal too, maybe with a code from the employer?\n\nBest regards\nClaudia Imhof",
        },
      },
    ],
  },
  sanitization: {
    clarifications: [
      { key: "no-email", q: "How do employees without an e-mail address sign in?", a: "The employer creates an activation code per employee; the employee sets a password with the code and a mobile number.", status: "answered", owner: "beat", answeredBy: "beat", answeredAt: "-8d@10:15", at: "-11d@09:00", source: "file:claudia-mail" },
      { key: "payroll-software", q: "Does the portal exchange data with the payroll software automatically?", a: "Phase 1: a CSV export of hours and absences in the payroll software's import format; payslips are uploaded as PDFs after the run.", status: "answered", owner: "elena", answeredBy: "beat", answeredAt: "-7d@14:00", at: "-11d@09:05", source: "note:monthly-cycle" },
      { key: "languages", q: "Which languages are needed at launch?", a: "German and French.", status: "answered", owner: "elena", answeredBy: "beat", answeredAt: "-9d@17:40", at: "-11d@09:10", source: "note:kickoff" },
      { key: "time-tracking", q: "Should hours be imported from the employers' own time-tracking tools?", status: "deferred", deferReason: "Later: only 9 of 120 employers use a tool today; phase 1 starts with the form and a CSV upload.", owner: "elena", at: "-11d@09:15", source: "note:beat-ideas" },
      { key: "retention", q: "How long must payslips stay available in the portal?", a: "Ten years, as for the payroll records.", status: "answered", owner: "reto", answeredBy: "beat", answeredAt: "-6d@08:30", at: "-10d@15:20" },
      { key: "holiday-balance", q: "Can employees see their remaining holiday days, or is that the employer's information?", status: "open", owner: "beat", at: "-1d@11:20", source: "note:beat-ideas" },
    ],
    decisions: [
      { key: "collect-publish", title: "The portal collects and publishes, payroll stays in the payroll software", statement: "Hours, absences and changes are collected in the portal and exported; the payroll calculation is not rebuilt.", rationale: "The payroll software is certified and known by the team; rebuilding it is out of budget.", by: "elena", at: "-7d@15:00", clar: "payroll-software", source: "note:kickoff" },
      { key: "activation-codes", title: "Employees without e-mail use activation codes", statement: "Employers hand out activation codes; employees sign in with a mobile number and password.", rationale: "About 15% of employees have no e-mail address.", by: "elena", at: "-8d@11:00", clar: "no-email" },
    ],
    tech: [
      { key: "platform", area: "stack", title: "Build on SELISE Blocks", choice: "SELISE Blocks (IAM with SMS one-time codes, Data Gateway, Storage) and a React web app", rationale: "Sign-in, documents and access rights per company come with the platform.", alternatives: ["Extend the client document portal", "Payroll software's own portal module"], experts: ["simon"], status: "accepted", by: "simon", at: "-6d@10:00" },
      { key: "export", area: "integration", title: "Export to the payroll software", choice: "Monthly CSV in the payroll software's import format, downloaded by the payroll team", rationale: "Works with today's import; no interface licence needed.", alternatives: ["Direct API (extra licence)"], experts: ["beat"], status: "accepted", by: "simon", at: "-6d@10:10", system: "Payroll software (CSV import)" },
      { key: "access", area: "security", title: "Access per company and employee", choice: "Employers see only their company; employees only their own documents; every download is logged", rationale: "Salary data is highly sensitive.", alternatives: [], experts: ["simon"], status: "accepted", by: "simon", at: "-6d@10:20" },
    ],
    discussion: [
      { by: "reto", at: "-12d@14:05", text: "Handed over. The template and the payslip layout are in Payroll today." },
      { by: "elena", at: "-2d@15:20", text: "All questions are answered or deferred; confirming the understanding now." },
    ],
  },
  requirements: [
    { key: "employer-hours", title: "Employers report hours and absences monthly", text: "Employers enter hours, overtime, holidays and sick days per employee by the 15th, in a form or by uploading the CSV template.", category: "functional", priority: "must", criteria: ["The form lists all employees of the company", "The CSV template can be uploaded instead", "A report can be corrected until the 15th"], sources: ["note:monthly-cycle", "file:hours-template"] },
    { key: "employer-changes", title: "Employers report new hires and leavers", text: "Employers report new employees and leavers with the data the payroll team needs.", category: "functional", priority: "must", criteria: ["A new hire needs name, start date, salary and AHV number", "A leaver needs the last working day"], sources: ["note:kickoff"] },
    { key: "employee-documents", title: "Employees download payslips and salary statements", text: "Employees see their payslips and yearly salary statements and download them as PDF.", category: "functional", priority: "must", criteria: ["Payslips appear after the payroll run", "Documents stay available for ten years"], sources: ["note:kickoff", "clar:retention"] },
    { key: "activation", title: "Employees without e-mail can sign in", text: "Employees activate their account with a code from the employer and their mobile number.", category: "security", priority: "must", criteria: ["The employer prints or sends an activation code", "The code works once and expires after 14 days"], sources: ["dec:activation-codes"] },
    { key: "reminders", title: "Employers get a reminder before the deadline", text: "Employers who have not reported by the 12th get a reminder e-mail.", category: "functional", priority: "nice", criteria: ["Reminder on the 12th at 08:00", "No reminder once the report is complete"], sources: ["note:beat-ideas"] },
    { key: "payroll-export", title: "The payroll team exports the month as CSV", text: "The payroll team downloads one CSV with all reported hours and absences in the payroll software's import format.", category: "integration", priority: "must", criteria: ["One file per payroll month", "Late changes are marked"], sources: ["clar:payroll-software"] },
  ],
  objective: {
    statement: "Employers of Lindenhof's 120 payroll clients report hours, absences and changes online by the 15th, and their 1'450 employees get payslips and salary statements in the portal, so the payroll team stops collecting spreadsheets by e-mail.",
    criteria: ["Employers report monthly data online or by CSV upload", "Employees download their payslips", "The payroll team exports the month in one file"],
    highLevelMd: "## Users\n- Employers of the payroll clients (owners, office managers)\n- Their employees, some without e-mail\n- Lindenhof's payroll team\n\n## Main flows\n- Monthly report of hours and absences\n- Publishing payslips after the payroll run\n- Export to the payroll software",
    architectureMd: "React web app on SELISE Blocks: IAM with SMS one-time codes, Data Gateway with access per company and employee, Storage for payslips, monthly CSV export.",
  },
  suggestions: [
    { key: "holiday-balance", source: "engine", title: "Show remaining holiday days", text: "Employees often ask how many holiday days they have left; the payroll software knows it after each run.", status: "open", at: "-2d@15:45" },
    { key: "sms-payslip-notice", source: "engine", title: "SMS when a new payslip is available", text: "Employees without e-mail get a short SMS when their payslip is in the portal.", status: "open", at: "-2d@15:45" },
    { key: "mobile-app", source: "engine", title: "Native mobile app", text: "A native app for iOS and Android instead of the web app.", status: "dismissed", at: "-2d@15:45", decidedBy: "elena", decidedAt: "-1d@09:30" },
  ],
  requirementFeedback: [
    {
      req: "activation",
      comments: [
        { by: "claudia", at: "-1d@17:10", text: "Can the employer also re-send a code when an employee loses it? That happens a lot with seasonal workers.", files: [{ type: "pdf", name: "Activation letter draft.pdf", issued: "-1d", issuer: "Lindenhof Treuhand AG", color: "7a4b2a", title: "Your access to the payroll portal", subtitle: "Letter to employees without e-mail (draft)", sections: [{ paragraphs: ["Dear employee", "From November you find your payslips online. Use the code below and your mobile number to activate your access. The code is valid for 14 days."] }, { heading: "Your code", paragraphs: ["XXXX-XXXX-XXXX"] }] }] },
        { by: "elena", at: "-0d@09:05", text: "Yes, a new code replaces the old one. I'll add it as an acceptance criterion." },
      ],
    },
  ],
  design: {
    mode: "sample",
    instructions: "Simple and calm, Lindenhof's brown and sand colours; large buttons for employees on the phone; the employer form works like a spreadsheet on a laptop.",
    samples: [
      { type: "png", name: "Lindenhof style sheet.png", image: { type: "stylesheet", company: "Lindenhof Treuhand AG", swatches: [["Walnut", "7a4b2a"], ["Sand", "e8dcc8"], ["Ink", "1f2933"], ["Sage", "8a9a5b"]], notes: ["Calm, serious, trustworthy", "Big buttons on the phone", "Tables on the laptop", "No playful icons"] } },
      { type: "png", name: "Reference - employer hours form.png", image: { type: "screen", device: "desktop", brand: "7a4b2a", app: "LINDENHOF", title: "Hours October", nav: ["Report", "Employees", "Documents"], blocks: [{ k: "table", head: ["No.", "Name", "Hours", "Holiday", "Sick"], rows: [["1001", "Sabine Kaufmann", "168", "0", "0"], ["1002", "Luca Moretti", "142", "2", "1"], ["1003", "Petra Albrecht", "84", "0", "0"]] }, { k: "button", text: "Send report" }] } },
    ],
    brand: "7a4b2a",
    app: "LINDENHOF PAYROLL",
    confirmedBy: "elena",
    screens: [],
  },
};
