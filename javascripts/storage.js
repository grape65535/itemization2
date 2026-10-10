'use strict';

// localStorage への保存・復元
const Storage = {
  loadDocument() {
    try {
      const json = localStorage.getItem(Config.storageKeyDocument);
      return json ? Model.normalize(JSON.parse(json)) : null;
    } catch (e) {
      console.warn('文書データの読み込みに失敗しました', e);
      return null;
    }
  },

  saveDocument(json) {
    try {
      localStorage.setItem(Config.storageKeyDocument, json);
    } catch (e) {
      console.warn('文書データの保存に失敗しました', e);
    }
  },

  // 表示状態（アクティブタブなど）。Undo 対象の文書データとは別に保存する
  loadUi() {
    try {
      return JSON.parse(localStorage.getItem(Config.storageKeyUi) || '{}') || {};
    } catch (e) {
      return {};
    }
  },

  saveUi(ui) {
    try {
      localStorage.setItem(Config.storageKeyUi, JSON.stringify(ui));
    } catch (e) {
      console.warn('表示状態の保存に失敗しました', e);
    }
  },
};
