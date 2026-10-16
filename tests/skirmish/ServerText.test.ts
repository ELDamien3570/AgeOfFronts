import { describe, expect, it } from "vitest";
import english from "../../resources/lang/en.json";
import { serverText, unsolicitedErrorText } from "../../src/skirmish/client/ServerText";
import {
  MATCH_INITIALIZATION_FAILED_MESSAGE,
  MATCH_STOPPED_MESSAGE,
  PUBLIC_SETUP_ERRORS,
} from "../../src/skirmish/multiplayer/application/TerminalMessages";

describe("fixed coordinator text", () => {
  it("maps every fixed terminal and setup string to an English translation entry", () => {
    expect(serverText(MATCH_STOPPED_MESSAGE)).toBe(english.skirmish_server.match_stopped);
    expect(serverText(MATCH_INITIALIZATION_FAILED_MESSAGE)).toBe(english.skirmish_server.match_initialization_failed);
    for (const message of PUBLIC_SETUP_ERRORS) {
      const shown = serverText(message);
      expect(Object.values(english.skirmish_server)).toContain(shown);
    }
    // The English entries mirror the server constants exactly.
    expect(english.skirmish_server.match_stopped).toBe(MATCH_STOPPED_MESSAGE);
    expect(english.skirmish_server.match_initialization_failed).toBe(MATCH_INITIALIZATION_FAILED_MESSAGE);
  });
  it("passes other server text through unchanged", () => {
    expect(serverText("This lobby is full.")).toBe("This lobby is full.");
  });
  it("surfaces only unsolicited lobby errors", () => {
    expect(unsolicitedErrorText({ type: "error", message: MATCH_INITIALIZATION_FAILED_MESSAGE }))
      .toBe(english.skirmish_server.match_initialization_failed);
    expect(unsolicitedErrorText({ type: "error", requestId: "join", message: "This lobby is full." })).toBeUndefined();
    expect(unsolicitedErrorText({ type: "ack", requestId: "join" })).toBeUndefined();
  });
});
