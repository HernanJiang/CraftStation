import { createProviderIcon } from "../common/createProviderIcon";

const ZCODE_PATH = "M3 3h18v4L9.2 17H21v4H3v-4L14.8 7H3Z";

export const ZCodeIcon = createProviderIcon({
  cssPrefix: "craftstation-zcode-icon",
  path: ZCODE_PATH,
  viewBox: "0 0 24 24",
});
