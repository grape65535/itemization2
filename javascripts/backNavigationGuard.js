'use strict';

// ブラウザの「戻る」による画面の再読み込み・別ページへの遷移を抑止する。
// どれか 1 つが効かないブラウザ・操作でも止まるよう、複数の手段を重ねる。
//  1. 履歴にダミーを積み、popstate（戻る）で積み直して元の画面に留まる
//  2. Navigation API があれば、履歴の移動（traverse）を取り消す
//  3. マウスの戻る/進むボタン（button 3/4）の既定動作を止める
//  4. 戻る/進むのキー操作（Alt+←/→、Cmd+[/]、BrowserBack/Forward キー、入力欄以外の BackSpace）を止める
//  5. beforeunload で離脱（再読み込み・別ページへの遷移）の確認を出す
//  6. bfcache から復元された時（pageshow）にダミーを積み直す
//  7. 最初のユーザー操作時にダミーを 1 つ追加で積む（操作前に積んだ履歴を飛ばすブラウザ向け）
//  ※ タッチパッド・タッチのスワイプで戻る操作は CSS の overscroll-behavior-x: none で抑止する
const BackNavigationGuard = {
  dummyCount: 2, // 積むダミーの数（連打で 1 つ戻られても残るよう複数）
  stateKey: 'itemizationGuard',
  isMac: /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),

  install() {
    if (this.installed) return;
    this.installed = true;
    this.pushDummies();
    // Chrome はユーザー操作前に積んだ履歴を「戻る」で飛ばすため、最初の操作時にもう 1 つ積む
    const arm = (e) => {
      if (!e.isTrusted) return;
      for (const type of ['pointerdown', 'keydown']) window.removeEventListener(type, arm, true);
      try {
        history.pushState({ [this.stateKey]: this.dummyCount }, '');
      } catch (err) {
        // 何もしない
      }
    };
    for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, arm, true);
    window.addEventListener('popstate', (e) => this.onPopState(e));
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) this.pushDummies();
    });
    this.installNavigationApi();
    for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick']) {
      window.addEventListener(type, (e) => this.onMouse(e), true);
    }
    window.addEventListener('keydown', (e) => this.onKeyDown(e), true);
    window.addEventListener('beforeunload', (e) => {
      e.preventDefault();
      e.returnValue = ''; // 古いブラウザ向け（確認ダイアログを出す）
      return '';
    });
  },

  // 1. 履歴のダミー。最上段に居ない（戻られた）ら積み直す
  pushDummies() {
    try {
      const state = history.state;
      const depth = state && state[this.stateKey] ? state[this.stateKey] : 0;
      if (depth === 0) history.replaceState({ ...(state || {}), [this.stateKey]: -1 }, ''); // 元の画面の印
      for (let i = Math.max(depth, 0) + 1; i <= this.dummyCount; i++) {
        history.pushState({ [this.stateKey]: i }, '');
      }
    } catch (err) {
      // file:// などで履歴を操作できない環境では他の手段に任せる
    }
  },

  onPopState() {
    const state = history.state;
    const depth = state && state[this.stateKey];
    if (depth === this.dummyCount) return; // 進むで最上段に戻った
    if (depth === -1 || (typeof depth === 'number' && depth > 0)) {
      // 自分で積んだ履歴の範囲内で戻った: 最上段まで積み直す
      this.pushDummies();
      return;
    }
    // 印の無い履歴（他の手段で入った履歴）: 最上段として積み直す
    try {
      history.pushState({ [this.stateKey]: this.dummyCount }, '');
    } catch (err) {
      // 何もしない
    }
  },

  // 2. Navigation API（Chromium 系）: 戻る/進むによる履歴の移動を取り消す
  installNavigationApi() {
    const nav = window.navigation;
    if (!nav || typeof nav.addEventListener !== 'function') return;
    nav.addEventListener('navigate', (e) => {
      if (e.navigationType === 'traverse' && e.cancelable) e.preventDefault();
    });
  },

  // 3. マウスの戻る(3)/進む(4)ボタン
  onMouse(e) {
    if (e.button === 3 || e.button === 4) e.preventDefault();
  },

  // 4. 戻る/進むのキー操作（既定動作だけ止め、アプリのキー処理には渡す）
  onKeyDown(e) {
    if (e.key === 'BrowserBack' || e.key === 'BrowserForward') {
      e.preventDefault();
      return;
    }
    const arrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
    // Mac の Alt+←/→ は文字入力の単語移動なので止めない
    if (!this.isMac && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && arrow) {
      e.preventDefault();
      return;
    }
    if (this.isMac && e.metaKey && !e.ctrlKey && !e.altKey && (e.key === '[' || e.key === ']' || (arrow && !Util.isTextInput(e.target)))) {
      e.preventDefault();
      return;
    }
    // 古いブラウザは入力欄以外の BackSpace で戻る
    if (e.key === 'Backspace' && !Util.isTextInput(e.target)) e.preventDefault();
  },
};
