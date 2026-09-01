import { describe, expect, it } from "vitest";
import { filterRemoteThreadEvents } from "./eventRouting";

describe("filterRemoteThreadEvents", () => {
  it("forwards in-app user notifications for watched threads", () => {
    const event = {
      type: "thread-user-notification",
      threadId: "thread-1",
      title: "Agent update",
      body: "Ready for review",
    };

    expect(filterRemoteThreadEvents(event, new Set(["thread-1"]))).toEqual(event);
    expect(filterRemoteThreadEvents(event, new Set(["thread-2"]))).toBeNull();
  });
});
