// EDIT THESE VALUES to change the application identity and default ports.
// Existing installations keep their saved ports until changed in settings.
module.exports = {
  appName: "BK Prompter",
  storageName: "BK Prompter", // Never rename: this identifies permanent user data.
  startupSettings: { backgroundColor: "#0c1a1d", width: 490, height: 630 },
  defaultWebPort: 7890,
  defaultOscPort: 7891,
  dataFolder: ".bk-prompter",
  defaultDisplay: {
    fontSize: 56,
    lineHeight: 1.5,
    margin: 120,
    background: "#090b0e",
    color: "#fffdf2",
    align: "left",
    mirror: false,
    flip: false,
    guide: true,
    guidePosition: 30,
  },
};
