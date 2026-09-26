/* eslint-disable no-undef */

var chromeHandle;
var addonRootURI;

function install() {}

async function startup({ resourceURI, rootURI }) {
  await Zotero.initializationPromise;

  if (!rootURI) {
    rootURI = resourceURI.spec;
  }
  addonRootURI = rootURI;

  const addonManagerStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = addonManagerStartup.registerChrome(manifestURI, [
    ["content", "__addonRef__", rootURI + "content/"],
  ]);

  const context = { rootURI };
  context._globalThis = context;
  Services.scriptloader.loadSubScript(
    `${rootURI}content/scripts/__addonRef__.js`,
    context,
  );
  await Zotero.__addonInstance__.hooks.onStartup();
}

async function onMainWindowLoad({ window }) {
  await Zotero.__addonInstance__?.hooks.onMainWindowLoad(window);
}

function onMainWindowUnload({ window }) {
  Zotero.__addonInstance__?.hooks.onMainWindowUnload(window);
}

function shutdown({ rootURI }, reason) {
  if (reason === APP_SHUTDOWN) return;

  if (typeof Zotero === "undefined") {
    Zotero = Components.classes["@zotero.org/Zotero;1"].getService(
      Components.interfaces.nsISupports,
    ).wrappedJSObject;
  }

  Zotero.__addonInstance__?.hooks.onShutdown();
  const scriptRootURI = rootURI || addonRootURI;
  if (scriptRootURI) {
    Cu.unload(`${scriptRootURI}content/scripts/__addonRef__.js`);
  }

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
  addonRootURI = null;
}

function uninstall() {}
