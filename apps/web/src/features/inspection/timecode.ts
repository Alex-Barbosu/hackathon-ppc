/** 00:12.4 style timecode, as drone footage players show it. */
export const timecode = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${(sec % 60).toFixed(1).padStart(4, "0")}`;
