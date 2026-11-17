// The client workspaces: who is in each one, with which role, and the workspace's custom roles.
// Built-in roles: owner (shown as "Workspace admin"), member, viewer. Custom roles hold permissions from
// blocks/data/validations.json WorkspaceRole.Permissions.
import type { WorkspaceDef } from "../model";

export const WORKSPACES: WorkspaceDef[] = [
  {
    key: "alpine-fresh",
    name: "Alpine Fresh AG",
    createdBy: "sandra",
    created: "-44d@09:10",
    roles: [
      {
        key: "client-reviewer",
        name: "Client reviewer",
        description: "Alpine Fresh staff who review scope and screens, comment and approve releases.",
        permissions: ["view", "comment", "share", "release.approve"],
        by: "sandra",
        at: "-43d@11:00",
      },
    ],
    members: [
      { person: "sandra", role: "owner", invitedBy: "sandra", invited: "-44d@09:10", joined: "-44d@09:10" },
      { person: "luca", role: "owner", invitedBy: "sandra", invited: "-44d@09:20", joined: "-44d@10:02" },
      { person: "elena", role: "member", invitedBy: "sandra", invited: "-44d@09:22", joined: "-43d@08:31" },
      { person: "marco", role: "member", invitedBy: "sandra", invited: "-41d@14:00", joined: "-41d@14:35" },
      { person: "anna", role: "member", invitedBy: "luca", invited: "-30d@10:15", joined: "-30d@13:02" },
      { person: "jonas", role: "viewer", invitedBy: "sandra", invited: "-43d@11:05", joined: "-43d@16:48" },
      { person: "petra", role: "client-reviewer", invitedBy: "sandra", invited: "-43d@11:06", joined: "-42d@07:55" },
      { person: "nicole", role: "viewer", status: "pending-account", invitedBy: "sandra", invited: "-2d@15:20" },
    ],
  },
  {
    key: "lindenhof",
    name: "Lindenhof Treuhand AG",
    createdBy: "reto",
    created: "-38d@08:45",
    roles: [
      {
        key: "client-it",
        name: "Client IT",
        description: "Lindenhof IT staff who add business material, answer the project's open questions and approve releases.",
        permissions: ["view", "comment", "business.edit", "sanitization.edit", "requirements.edit", "release.approve"],
        by: "reto",
        at: "-38d@09:00",
      },
    ],
    members: [
      { person: "reto", role: "owner", invitedBy: "reto", invited: "-38d@08:45", joined: "-38d@08:45" },
      { person: "elena", role: "member", invitedBy: "reto", invited: "-38d@08:50", joined: "-38d@09:30" },
      { person: "simon", role: "member", invitedBy: "reto", invited: "-38d@08:51", joined: "-37d@08:12" },
      { person: "claudia", role: "viewer", invitedBy: "reto", invited: "-37d@10:00", joined: "-36d@18:22" },
      { person: "beat", role: "client-it", invitedBy: "reto", invited: "-37d@10:02", joined: "-37d@10:40" },
      { person: "marco", role: "member", status: "invited", invitedBy: "reto", invited: "-1d@16:05" },
    ],
  },
  {
    key: "talwerk",
    name: "Talwerk Fluidsysteme GmbH",
    createdBy: "katrin",
    created: "-58d@08:30",
    roles: [
      {
        key: "product-owner",
        name: "Product owner",
        description: "Owns a product line: brings the business material, shapes requirements and scope, requests releases.",
        permissions: [
          "view", "comment", "share", "items.shareExternal", "project.create", "project.assign", "business.edit", "sanitization.edit",
          "requirements.edit", "design.edit", "scope.lock", "board.edit", "release.request", "wiki.edit",
        ],
        by: "katrin",
        at: "-58d@09:00",
      },
      {
        key: "release-manager",
        name: "Release manager",
        description: "Runs builds, manages approval rules and promotes approved versions to stage and production.",
        permissions: ["view", "comment", "build.run", "release.request", "release.approve", "release.promote", "release.manage-approvals", "wiki.edit"],
        by: "katrin",
        at: "-58d@09:05",
      },
    ],
    members: [
      { person: "katrin", role: "owner", invitedBy: "katrin", invited: "-58d@08:30", joined: "-58d@08:30" },
      { person: "stefan", role: "owner", invitedBy: "katrin", invited: "-58d@08:40", joined: "-58d@09:12" },
      { person: "aylin", role: "product-owner", invitedBy: "katrin", invited: "-58d@09:10", joined: "-57d@08:05" },
      { person: "jan", role: "release-manager", invitedBy: "katrin", invited: "-58d@09:11", joined: "-57d@10:30" },
      { person: "luca", role: "member", invitedBy: "stefan", invited: "-56d@13:00", joined: "-56d@13:20" },
      { person: "florian", role: "viewer", invitedBy: "stefan", invited: "-55d@09:00", joined: "-55d@11:47" },
      { person: "martina", role: "viewer", invitedBy: "aylin", invited: "-50d@14:10", joined: "-49d@08:02" },
      { person: "oliver", role: "member", status: "suspended", invitedBy: "katrin", invited: "-57d@10:00", joined: "-57d@15:10", suspended: "-12d@16:00" },
      { person: "lena", role: "member", status: "pending-account", invitedBy: "aylin", invited: "-1d@11:30" },
    ],
  },
];
