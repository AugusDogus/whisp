import { expect, test } from "bun:test";

import { PreviewSettings } from "./preview-settings";

function disk() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test("self-send defaults off and remembers both choices across app launches", () => {
  const storage = disk();
  const first = PreviewSettings.create("whisp.chat.preview", storage);
  expect(first.getState().allowSelfMessages).toBe(false);
  first.getState().setAllowSelfMessages(true);
  const reopened = PreviewSettings.create("whisp.chat.preview", storage);
  expect(reopened.getState().allowSelfMessages).toBe(true);
  reopened.getState().setAllowSelfMessages(false);
  expect(
    PreviewSettings.create("whisp.chat.preview", storage).getState()
      .allowSelfMessages,
  ).toBe(false);
});

test.each(["whisp.chat", null, "host.exp.Exponent"])(
  "%s never loads or enables preview settings",
  (applicationId) => {
    let accessed = false;
    const store = PreviewSettings.create(applicationId, {
      getItem: () => {
        accessed = true;
        return "true";
      },
      setItem: () => {
        accessed = true;
      },
    });
    store.getState().setAllowSelfMessages(true);
    expect(store.getState().allowSelfMessages).toBe(false);
    expect(PreviewSettings.isPreview(applicationId)).toBe(false);
    expect(accessed).toBe(false);
  },
);

test("a failed save preserves the previous choice and reports the error", () => {
  const store = PreviewSettings.create("whisp.chat.preview", {
    getItem: () => "true",
    setItem: () => {
      throw new Error("Storage unavailable");
    },
  });
  store.getState().setAllowSelfMessages(false);
  expect(store.getState().allowSelfMessages).toBe(true);
  expect(store.getState().error).toContain("previous choice is unchanged");
});

test("a failed read defaults off and a successful toggle clears the error", () => {
  const store = PreviewSettings.create("whisp.chat.preview", {
    getItem: () => {
      throw new Error("Storage unavailable");
    },
    setItem: () => {},
  });
  expect(store.getState().allowSelfMessages).toBe(false);
  expect(store.getState().error).toContain("Could not load");
  store.getState().setAllowSelfMessages(true);
  expect(store.getState().allowSelfMessages).toBe(true);
  expect(store.getState().error).toBeNull();
});
