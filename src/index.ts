import { config } from "../package.json";
import { RecordNumberManager } from "./recordNumberManager";
import { RecordNumberUI } from "./ui";

class AddonController {
  private readonly manager = new RecordNumberManager();
  private readonly ui = new RecordNumberUI(this.manager);

  readonly hooks = {
    onStartup: async (): Promise<void> => {
      await Promise.all([
        Zotero.initializationPromise,
        Zotero.unlockPromise,
        Zotero.uiReadyPromise,
      ]);
      await this.manager.start();
      for (const win of Zotero.getMainWindows()) {
        this.ui.addToWindow(win);
      }
    },

    onMainWindowLoad: async (
      win: _ZoteroTypes.MainWindow,
    ): Promise<void> => {
      this.ui.addToWindow(win);
    },

    onMainWindowUnload: (win: _ZoteroTypes.MainWindow): void => {
      this.ui.removeFromWindow(win);
    },

    onShutdown: (): void => {
      for (const win of Zotero.getMainWindows()) {
        this.ui.removeFromWindow(win);
      }
      this.manager.stop();
      delete (Zotero as unknown as Record<string, unknown>)[
        config.addonInstance
      ];
    },
  };
}

const controller = new AddonController();
(_globalThis as Record<string, unknown>).addon = controller;
(Zotero as unknown as Record<string, unknown>)[config.addonInstance] =
  controller;
