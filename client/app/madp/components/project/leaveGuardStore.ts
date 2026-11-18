/** The question before leaving a project: the project switcher and the workspace switch ask `confirmLeave()`; the
 *  guard host of the open project page (LeaveGuardHost, mounted by the project switcher) answers it, at once when nothing
 *  is unfinished there, else after the person chose in LeaveProjectDialog. Off a project page nothing guards and the
 *  answer is "go" at once. Menus that can leave the project warm the host while they are open, so its facts are read
 *  before a choice is made. */
import { useEffect } from "react";
import { create } from "zustand";

export interface LeaveRequest {
  id: number;
  /** called once, just before the dialog shows: the menu closes and puts focus back on its button (the dialog then
   *  returns focus there) */
  onAsk?: () => void;
  resolve: (go: boolean) => void;
}

interface LeaveGuardState {
  /** guard hosts mounted (one per open project page) */
  hosts: number;
  /** open menus that can leave the project */
  warm: number;
  request: LeaveRequest | null;
}

export const useLeaveGuard = create<LeaveGuardState>(() => ({ hosts: 0, warm: 0, request: null }));

let seq = 0;

/** Resolves true to go on with the switch, false to stay. */
export function confirmLeave(onAsk?: () => void): Promise<boolean> {
  const { hosts, request } = useLeaveGuard.getState();
  if (hosts === 0) return Promise.resolve(true);
  // a newer choice replaces one still waiting (that one stays)
  request?.resolve(false);
  return new Promise<boolean>((resolve) => {
    seq += 1;
    useLeaveGuard.setState({ request: { id: seq, onAsk, resolve } });
  });
}

/** The host's answer to the waiting request. */
export function settleLeave(go: boolean): void {
  const { request } = useLeaveGuard.getState();
  if (!request) return;
  useLeaveGuard.setState({ request: null });
  request.resolve(go);
}

const bump = (key: "hosts" | "warm", by: 1 | -1) => useLeaveGuard.setState((s) => ({ [key]: Math.max(0, s[key] + by) }) as Partial<LeaveGuardState>);

/** A menu that can leave the project, while `open`: the host reads its facts meanwhile. */
export function useLeaveGuardWarm(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    bump("warm", 1);
    return () => bump("warm", -1);
  }, [open]);
}

/** Registers the guard host while it is mounted; a request still waiting when it goes is answered "stay". */
export function useLeaveGuardHost(): void {
  useEffect(() => {
    bump("hosts", 1);
    return () => {
      bump("hosts", -1);
      if (useLeaveGuard.getState().hosts === 0) settleLeave(false);
    };
  }, []);
}
