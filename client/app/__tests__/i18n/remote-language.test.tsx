import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useI18nStore } from "@seliseblocks/genesis-os/i18n";
import { useAppSettingsStore } from "@seliseblocks/genesis-os/store";
import { RepositoryCard } from "@/components/module/repos/repository-card";
import type { IRepo } from "@/models/repos.model";

const repo = { repoUrl: "", deploymentType: "", customDeploymentUrl: "" } as unknown as IRepo;

describe("text in a non-default language", () => {
  afterEach(() => {
    act(() => {
      useAppSettingsStore.getState().setSettings({ language: "en" });
      useI18nStore.setState({ remote: {} });
    });
  });

  it("shows English by default", () => {
    render(<RepositoryCard repo={repo} />);
    expect(screen.getByText("Deployment type")).toBeInTheDocument();
  });

  it("shows the remote text once it is registered for the selected language", () => {
    render(<RepositoryCard repo={repo} />);
    act(() => {
      useI18nStore.getState().setRemote("xx", "monitor.repos", {
        "REPOSITORY_CARD.DEPLOYMENT_TYPE": "[xx] Deployment type",
      });
      useAppSettingsStore.getState().setSettings({ language: "xx" });
    });
    expect(screen.getByText("[xx] Deployment type")).toBeInTheDocument();
    // A key without remote text falls back to the bundled English.
    expect(screen.getByText("Custom URL")).toBeInTheDocument();
  });
});
