const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wordbook", {
  load: () => ipcRenderer.invoke("app:load"),
  importWords: payload => ipcRenderer.invoke("words:import", payload),
  generateQuiz: () => ipcRenderer.invoke("quiz:generate"),
  recordAnswer: payload => ipcRenderer.invoke("quiz:answer", payload),
  saveSettings: settings => ipcRenderer.invoke("settings:save", settings),
  testProvider: settings => ipcRenderer.invoke("provider:test", settings)
});
