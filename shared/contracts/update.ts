export interface UpdateView {
  currentVersion: string;
  phase:
    | "unavailable"
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "installing"
    | "error";
  nextVersion: string | null;
  percent: number;
  message: string;
  checkedAt: string | null;
}
