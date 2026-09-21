import { createProviderIcon } from "../common/createProviderIcon";

const MINIMAX_PATH =
  "M12 2 3 7v10l9 5 9-5V7Zm0 3.2 5.7 3.1-2.5 1.4L12 8l-3.2 1.7-2.5-1.4Zm-6 6.2 4.5 2.5v4.5L6 15.9Zm7.5 7v-4.5l4.5-2.5v4.5Z";

export const MiniMaxIcon = createProviderIcon({
  cssPrefix: "craftstation-minimax-icon",
  path: MINIMAX_PATH,
  viewBox: "0 0 24 24",
});
