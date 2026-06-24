export class TabsController {
  constructor() {
    this.activeTabId = 'home';
    this.tabs = [
      {
        id: 'home',
        title: 'Launcher',
        kind: 'launcher',
        closable: false,
      },
    ];
  }

  getTabIdForTarget(target) {
    if (target.kind === 'launcher') return 'home';
    if (target.kind === 'remote' && target.id) return `remote:${target.id}`;
    return target.kind;
  }

  upsertTarget(target) {
    const tabId = this.getTabIdForTarget(target);
    const existingTab = this.tabs.find((tab) => tab.id === tabId);
    const nextTab = {
      id: tabId,
      title: target.kind === 'launcher' ? 'Launcher' : target.name,
      kind: target.kind,
      target,
      closable: tabId !== 'home',
    };

    if (existingTab) {
      Object.assign(existingTab, nextTab);
    } else {
      this.tabs.push(nextTab);
    }

    this.activeTabId = tabId;
    return nextTab;
  }

  activate(tabId) {
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) return null;
    this.activeTabId = tab.id;
    return tab;
  }

  remove(tabId) {
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab || !tab.closable) return null;
    this.tabs = this.tabs.filter((item) => item.id !== tabId);
    if (this.activeTabId === tabId) {
      this.activeTabId = 'home';
    }
    return tab;
  }

  removeByKind(kind) {
    const removed = this.tabs.filter((tab) => tab.kind === kind && tab.closable);
    if (!removed.length) return [];

    const removedIds = new Set(removed.map((tab) => tab.id));
    this.tabs = this.tabs.filter((tab) => !removedIds.has(tab.id));
    if (removedIds.has(this.activeTabId)) {
      this.activeTabId = 'home';
    }
    return removed;
  }

  getActiveTab() {
    return this.getTab(this.activeTabId);
  }

  getTab(tabId) {
    return this.tabs.find((item) => item.id === tabId) || null;
  }

  getSerializableTabs() {
    return this.tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      kind: tab.kind,
      closable: tab.closable,
      active: tab.id === this.activeTabId,
    }));
  }
}
