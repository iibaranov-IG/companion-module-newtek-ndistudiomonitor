const {
  InstanceBase,
  InstanceStatus,
  Regex,
  combineRgb,
} = require("@companion-module/base");
const legacyActions = require("./actions");
const legacyFeedbacks = require("./feedbacks");
const { createDigestAuthorization } = require("./protocol");

class NDIStudioMonitorInstance extends InstanceBase {
  constructor(internal) {
    super(internal);
    this.timers = {};
    this.auth = { challenge: undefined, nonceCount: 0 };
    this.pollResults = {
      ndiSources: [],
      oldNdiSources: [],
      activeSource: {},
      activeOverlay: {},
      overlayModePiP: undefined,
      recording: undefined,
      audioMute: undefined,
    };
    this.defaultColors = {
      fg: combineRgb(255, 255, 255),
      bg: combineRgb(0, 0, 0),
    };
    this.feedbackColors = {
      active_source: {
        fg: combineRgb(255, 255, 255),
        bg: combineRgb(255, 0, 0),
      },
      active_overlay: { fg: combineRgb(0, 0, 0), bg: combineRgb(255, 255, 0) },
      recording: { fg: combineRgb(255, 255, 255), bg: combineRgb(255, 0, 0) },
      audio_mute: { fg: combineRgb(255, 255, 255), bg: combineRgb(255, 0, 0) },
    };
  }

  async init(config) {
    this.config = config;
    this.initVariables();
    this.initActions();
    this.initFeedbacks();
    this.updatePresets();
    await this.connect();
  }
  async configUpdated(config) {
    this.config = config;
    this.auth = { challenge: undefined, nonceCount: 0 };
    this.stopPolling();
    await this.connect();
  }
  async destroy() {
    this.stopPolling();
    clearTimeout(this.timers.reconnect);
  }

  getConfigFields() {
    return [
      {
        type: "static-text",
        id: "info",
        label: "NDI Studio Monitor",
        width: 12,
        value: "Control NDI Studio Monitor through its local web-control API.",
      },
      {
        type: "textinput",
        id: "host",
        label: "Host or IP address",
        width: 8,
        default: "127.0.0.1",
        regex: Regex.SOMETHING,
      },
      {
        type: "number",
        id: "port",
        label: "Port",
        width: 4,
        default: 80,
        min: 1,
        max: 65535,
        asInteger: true,
      },
      {
        type: "checkbox",
        id: "useWebPassword",
        label: "Use web password",
        width: 12,
        default: true,
      },
      {
        type: "textinput",
        id: "username",
        label: "Web user",
        width: 6,
        default: "admin",
      },
      {
        type: "textinput",
        id: "password",
        label: "Web password",
        width: 6,
        default: "admin",
        isPassword: true,
      },
    ];
  }

  initVariables() {
    this.setVariableDefinitions(
      Object.fromEntries(
        [
          "activeSourceComplete",
          "activeSourceHost",
          "activeSourceName",
          "activeOverlayComplete",
          "activeOverlayHost",
          "activeOverlayName",
          "recording",
          "recordingTimeS",
          "recordingTimeMS",
        ].map((variableId) => [variableId, { name: variableId }]),
      ),
    );
  }
  initActions() {
    const actions = {};
    for (const [id, definition] of Object.entries(
      legacyActions.getActions.call(this),
    )) {
      actions[id] = {
        ...definition,
        name: definition.label,
        callback: async (action) => this.executeAction(id, action.options),
      };
      delete actions[id].label;
    }
    this.setActionDefinitions(actions);
  }
  initFeedbacks() {
    const feedbacks = {};
    const styles = {
      active_source: this.feedbackColors.active_source,
      active_overlay: this.feedbackColors.active_overlay,
      active_overlay_pip: this.feedbackColors.active_overlay,
      active_overlay_alpha: this.feedbackColors.active_overlay,
      recording: this.feedbackColors.recording,
      audio_mute: this.feedbackColors.audio_mute,
    };
    for (const [id, definition] of Object.entries(
      legacyFeedbacks.getFeedbacks.call(this),
    )) {
      const style = styles[id];
      feedbacks[id] = {
        type: "boolean",
        name: definition.label,
        description: definition.description,
        options: definition.options.filter(
          (option) => option.id !== "fg" && option.id !== "bg",
        ),
        defaultStyle: { color: style.fg, bgcolor: style.bg },
        callback: (feedback) =>
          Boolean(
            definition.callback({
              ...feedback,
              options: {
                ...feedback.options,
                fg: style.fg,
                bg: style.bg,
              },
            }),
          ),
      };
    }
    this.setFeedbackDefinitions(feedbacks);
  }

  updatePresets() {
    const definitions = {};
    const sections = new Map();
    const addPreset = ({
      id,
      category,
      name,
      text,
      action,
      options,
      feedback,
    }) => {
      definitions[id] = {
        type: "simple",
        name,
        style: {
          text,
          size: "auto",
          color: this.defaultColors.fg,
          bgcolor: this.defaultColors.bg,
        },
        steps: [
          {
            down: [{ actionId: action, options: options ?? {} }],
            up: [],
          },
        ],
        feedbacks: feedback
          ? [
              {
                feedbackId: feedback.id,
                options: feedback.options ?? {},
                style: feedback.style,
              },
            ]
          : [],
      };
      if (!sections.has(category)) sections.set(category, []);
      sections.get(category).push(id);
    };

    for (const [index, source] of this.pollResults.ndiSources.entries()) {
      for (const [category, prefix, action, feedbackId] of [
        ["Sources", "", "source", "active_source"],
        ["Overlay PiP", "PiP: ", "overlay_pip", "active_overlay_pip"],
        ["Overlay alpha", "Alpha: ", "overlay_alpha", "active_overlay_alpha"],
      ]) {
        const colors =
          feedbackId === "active_source"
            ? this.feedbackColors.active_source
            : this.feedbackColors.active_overlay;
        addPreset({
          id: `${action}_${index}`,
          category,
          name: `${prefix}${source.label}`,
          text: `${prefix}${source.label}`,
          action,
          options: { source: source.id },
          feedback: {
            id: feedbackId,
            options: { source: source.id },
            style: { color: colors.fg, bgcolor: colors.bg },
          },
        });
      }
    }
    addPreset({
      id: "overlay_hide",
      category: "Controls",
      name: "Hide overlay",
      text: "Hide overlay",
      action: "overlay_hide",
    });
    addPreset({
      id: "audio_mute",
      category: "Controls",
      name: "Mute audio",
      text: "Mute audio",
      action: "audio_mute",
      feedback: {
        id: "audio_mute",
        style: {
          color: this.feedbackColors.audio_mute.fg,
          bgcolor: this.feedbackColors.audio_mute.bg,
        },
      },
    });
    addPreset({
      id: "audio_unmute",
      category: "Controls",
      name: "Unmute audio",
      text: "Unmute audio",
      action: "audio_unmute",
    });
    this.setPresetDefinitions(
      [...sections.entries()].map(([name, presetIds], index) => ({
        id: `section_${index}`,
        name,
        definitions: presetIds,
      })),
      definitions,
    );
  }

  async connect() {
    clearTimeout(this.timers.reconnect);
    this.stopPolling();
    if (!this.config.host)
      return this.updateStatus(InstanceStatus.BadConfig, "Host not set");
    this.updateStatus(InstanceStatus.Connecting);
    try {
      const response = await this.request("/", "GET");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.updateStatus(InstanceStatus.Ok);
      this.startPolling();
    } catch (error) {
      this.updateStatus(InstanceStatus.ConnectionFailure, error.message);
      this.timers.reconnect = setTimeout(() => void this.connect(), 1000);
    }
  }
  startPolling() {
    this.stopPolling();
    void this.pollSources();
    void this.pollConfiguration();
    void this.pollRecording();
    this.timers.sources = setInterval(() => void this.pollSources(), 5000);
    this.timers.configuration = setInterval(
      () => void this.pollConfiguration(),
      1000,
    );
    this.timers.recording = setInterval(() => void this.pollRecording(), 1000);
  }
  stopPolling() {
    for (const key of ["sources", "configuration", "recording"]) {
      clearInterval(this.timers[key]);
      this.timers[key] = undefined;
    }
  }
  url(path) {
    return `http://${this.config.host}:${Number(this.config.port) || 80}${path}`;
  }

  async request(path, method, body) {
    const send = (authorization) =>
      fetch(this.url(path), {
        method,
        headers: {
          ...(authorization ? { Authorization: authorization } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    let response = await send();
    if (response.status !== 401 || !this.config.useWebPassword) return response;
    this.auth.challenge = response.headers.get("www-authenticate");
    const authorization = createDigestAuthorization({
      method,
      path,
      challenge: this.auth.challenge,
      username: this.config.username ?? "admin",
      password: this.config.password ?? "admin",
      nonceCount: ++this.auth.nonceCount,
    });
    if (!authorization) throw new Error("Invalid Digest challenge");
    response = await send(authorization);
    if (response.status === 401)
      throw new Error("Login failed: check web user and password");
    return response;
  }
  async json(path) {
    const response = await this.request(path, "GET");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  async pollSources() {
    try {
      const data = await this.json("/v1/sources");
      const sources = Array.isArray(data.ndi_sources)
        ? ["", ...data.ndi_sources]
        : [];
      this.pollResults.ndiSources = sources.map((id) => ({
        id,
        label: id || "None",
      }));
      if (
        JSON.stringify(this.pollResults.ndiSources) !==
        JSON.stringify(this.pollResults.oldNdiSources)
      ) {
        this.pollResults.oldNdiSources = structuredClone(
          this.pollResults.ndiSources,
        );
        this.initActions();
        this.initFeedbacks();
        this.updatePresets();
      }
    } catch {
      void this.connect();
    }
  }
  async pollConfiguration() {
    try {
      const data = await this.json("/v1/configuration");
      this.setSource("activeSource", data.NDI_source, "activeSource");
      this.setSource("activeOverlay", data.NDI_overlay, "activeOverlay");
      this.pollResults.overlayModePiP = data.decorations?.picture_in_picture;
      this.pollResults.audioMute = data.decorations?.mute_audio;
      this.checkFeedbacks(
        "active_source",
        "active_overlay",
        "active_overlay_pip",
        "active_overlay_alpha",
        "audio_mute",
      );
    } catch {
      void this.connect();
    }
  }
  async pollRecording() {
    try {
      const data = await this.json("/v1/recording");
      const seconds = Number.parseInt(data.duration, 10) || 0;
      this.pollResults.recording = data.recording;
      this.setVariableValues({
        recording: data.recording,
        recordingTimeS: seconds,
        recordingTimeMS: `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`,
      });
      this.checkFeedbacks("recording");
    } catch {
      void this.connect();
    }
  }
  setSource(key, value, prefix) {
    const source = value || "";
    const match = /^(.*?)\s*\((.*)\)$/.exec(source);
    this.pollResults[key] = {
      complete: source,
      host: match?.[1] ?? source,
      name: match?.[2] ?? source,
    };
    this.setVariableValues({
      [`${prefix}Complete`]: source || "None",
      [`${prefix}Host`]: source ? this.pollResults[key].host : "None",
      [`${prefix}Name`]: source ? this.pollResults[key].name : "None",
    });
  }
  async executeAction(id, options) {
    const actions = {
      source: ["configuration", { NDI_source: options.source }],
      overlay_pip: [
        "configuration",
        {
          NDI_overlay: options.source,
          decorations: { picture_in_picture: true },
        },
      ],
      overlay_alpha: [
        "configuration",
        {
          NDI_overlay: options.source,
          decorations: { picture_in_picture: false },
        },
      ],
      overlay_hide: ["configuration", { NDI_overlay: "" }],
      audio_mute: ["configuration", { decorations: { mute_audio: true } }],
      audio_unmute: ["configuration", { decorations: { mute_audio: false } }],
      rec_start: ["recording", { recording: true }],
      rec_stop: ["recording", { recording: false }],
    };
    let action = actions[id];
    if (id === "customJSON") {
      try {
        action = ["configuration", JSON.parse(options.customJSON)];
      } catch {
        return this.log("warn", "Custom JSON is invalid");
      }
    }
    if (!action) return;
    const [page, body] = action;
    if (page === "configuration" && body.version === undefined)
      body.version = 1;
    try {
      const response = await this.request(`/v1/${page}`, "POST", body);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      this.log("warn", `Studio Monitor command failed: ${error.message}`);
      void this.connect();
    }
  }
}

// Companion module-base 2 loads the instance constructor as the default export.
// The old `runEntrypoint()` bootstrap was removed in module-base 2.
module.exports = NDIStudioMonitorInstance;
