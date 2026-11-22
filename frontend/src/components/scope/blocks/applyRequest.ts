/** "Apply in the scope": an accepted second-opinion point asks the editor to open its target prefilled. */
export interface ApplyRequest {
  challengeId: string;
  /** The feature or story the point is about; null means a new feature. */
  target: { type: "feature" | "story"; id: string } | null;
  text: string;
}
