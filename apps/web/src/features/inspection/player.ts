import type { Window } from "../../three/inspectionScene";

/** What the page needs from either source: the rendered flight or a supplied clip. */
export interface PlayerState {
  sec: number;
  playing: boolean;
  duration: number;
  windows: Window[];
  failed: boolean;
  selected: string | null;
  toggle: () => void;
  seek: (sec: number) => void;
  focus: (id: string) => void;
}
