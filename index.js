// ゲームの状態を管理
const gameState = {
  isRunning: false,
  startTime: 0,
  elapsedTime: 0,
  timer: null,
  totalTyped: 0,
  correctTyped: 0,
  currentIndex: 0,
  sentences: [],
  originalSentences: [],
  currentSentence: "",
  isComposing: false,
  skippedSentences: 0,
  randomizeOrder: false,
  textHash: "", // テキストのハッシュ値
  completedSentences: new Set(), // 完了した文章のインデックス
};

// 進捗保存用の変数
let lastSaveTime = 0;
const SAVE_THROTTLE_MS = 1000; // 1秒に1回のみ保存

// デバウンス関数（短時間の連続呼び出しを最後の1回にまとめる）
function debounce(fn, ms) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), ms);
  };
}

// DOM要素
const elements = {
  setupScreen: document.getElementById("setup-screen"),
  gameScreen: document.getElementById("game-screen"),
  resultScreen: document.getElementById("result-screen"),
  textMaterial: document.getElementById("text-material"),
  fileUpload: document.getElementById("file-upload"),
  processTextBtn: document.getElementById("process-text-btn"),
  textStats: document.getElementById("text-stats"),
  sentenceCount: document.getElementById("sentence-count"),
  characterCount: document.getElementById("character-count"),
  estimatedTime: document.getElementById("estimated-time"),
  startGameBtn: document.getElementById("start-game-btn"),
  timerDisplay: document.getElementById("timer-display"),
  targetText: document.getElementById("target-text"),
  typingInput: document.getElementById("typing-input"),
  accuracyDisplay: document.getElementById("accuracy-display"),
  speedDisplay: document.getElementById("speed-display"),
  progressDisplay: document.getElementById("progress-display"),
  progressBar: document.getElementById("progress-bar"),
  currentSentenceIndex: document.getElementById("current-sentence-index"),
  totalSentences: document.getElementById("total-sentences"),
  compositionStatus: document.getElementById("composition-status"),
  restartBtn: document.getElementById("restart-btn"),
  returnSetupBtn: document.getElementById("return-setup-btn"), // 追加: 設定に戻るボタン
  retryBtn: document.getElementById("retry-btn"),
  finalTime: document.getElementById("final-time"),
  finalAccuracy: document.getElementById("final-accuracy"),
  finalSpeed: document.getElementById("final-speed"),
  finalTotalTyped: document.getElementById("final-total-typed"),
  finalCorrectTyped: document.getElementById("final-correct-typed"),
  returnBtn: document.getElementById("return-btn"),
  randomOrderCheckbox: document.getElementById("random-order"),
  toastContainer: document.getElementById("toast-container"),
  useSegmenterCheckbox: document.getElementById("use-segmenter"),
  filterPatternInput: document.getElementById("filter-pattern"),
  filterReplacementInput: document.getElementById("filter-replacement"),
  splitPatternInput: document.getElementById("split-pattern"),
  previewContainer: document.getElementById("preview-container"),
  sentencePreviewList: document.getElementById("sentence-preview-list"),
  contextTextBefore: document.getElementById("context-text-before"),
  contextTextAfter: document.getElementById("context-text-after"),
};

// スクリーンの切り替え
function showScreen(screenId) {
  // すべてのスクリーンを非アクティブにする
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });

  // 指定されたスクリーンをアクティブにする
  document.getElementById(screenId).classList.add("active");
}

// トースト通知を表示
function showToast(type, message, duration = 1500) {
  // トースト要素の作成
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  // アイコンとメッセージを設定
  let iconHTML = "";
  if (type === "success") {
    iconHTML = '<span class="toast-icon success-icon">✓</span>';
  } else if (type === "info") {
    iconHTML = '<span class="toast-icon info-icon">ℹ️</span>';
  }

  toast.innerHTML = `
              ${iconHTML}
              <span class="toast-text">${message}</span>
          `;

  // トーストコンテナに追加
  elements.toastContainer.appendChild(toast);

  // アニメーションのためのタイミング調整
  setTimeout(() => {
    toast.classList.add("show");

    // 一定時間後に削除
    setTimeout(() => {
      toast.classList.remove("show");

      setTimeout(() => {
        toast.remove();
      }, 300);
    }, duration);
  }, 10);
}

// 配列をシャッフルする関数
function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

// テキストからSHA-256ハッシュを生成
async function generateTextHash(sentences) {
  const text = sentences.join("\n");
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hashHex;
}

// localStorageに進捗を保存（1秒に1回のthrottle付き）
function saveProgress() {
  const now = Date.now();
  if (now - lastSaveTime < SAVE_THROTTLE_MS) {
    return; // throttle中はスキップ
  }
  lastSaveTime = now;

  if (!gameState.textHash) return;

  const progressData = {
    originalSentences: gameState.originalSentences,
    randomizeOrder: gameState.randomizeOrder,
    completedSentences: Array.from(gameState.completedSentences),
    totalTyped: gameState.totalTyped,
    correctTyped: gameState.correctTyped,
    elapsedTime: gameState.elapsedTime,
    skippedSentences: gameState.skippedSentences,
    currentIndex: gameState.currentIndex,
    timestamp: now,
  };

  try {
    localStorage.setItem(`typing-progress-${gameState.textHash}`, JSON.stringify(progressData));
    // URLパラメータを更新
    const newUrl = `${window.location.pathname}?hash=${gameState.textHash}`;
    window.history.replaceState({}, "", newUrl);
  } catch (e) {
    console.error("保存エラー:", e);
  }
}

// localStorageから進捗を読み込み
function loadProgress(hash) {
  try {
    const data = localStorage.getItem(`typing-progress-${hash}`);
    if (!data) return null;
    return JSON.parse(data);
  } catch (e) {
    console.error("読み込みエラー:", e);
    return null;
  }
}

// 進捗データを削除
function clearProgress(hash) {
  try {
    localStorage.removeItem(`typing-progress-${hash}`);
  } catch (e) {
    console.error("削除エラー:", e);
  }
}

// URLパラメータから進捗を復元
async function loadFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  const hash = urlParams.get("hash");

  if (!hash) return;

  const progressData = loadProgress(hash);
  if (!progressData) {
    console.log("保存されたデータが見つかりません");
    return;
  }

  // データを復元
  gameState.originalSentences = progressData.originalSentences;
  gameState.randomizeOrder = progressData.randomizeOrder;
  gameState.completedSentences = new Set(progressData.completedSentences);
  gameState.totalTyped = progressData.totalTyped;
  gameState.correctTyped = progressData.correctTyped;
  gameState.elapsedTime = progressData.elapsedTime;
  gameState.skippedSentences = progressData.skippedSentences;
  gameState.currentIndex = progressData.currentIndex;
  gameState.textHash = hash;

  // ランダム化設定を適用
  if (gameState.randomizeOrder) {
    gameState.sentences = shuffleArray(gameState.originalSentences);
  } else {
    gameState.sentences = [...gameState.originalSentences];
  }

  // 完了した文章をスキップして次の未完了文章から再開
  while (
    gameState.currentIndex < gameState.sentences.length &&
    gameState.completedSentences.has(gameState.currentIndex)
  ) {
    gameState.currentIndex++;
  }

  // 自動的にゲーム画面に遷移して再開
  showScreen("game-screen");
  elements.totalSentences.textContent = gameState.sentences.length;
  elements.typingInput.disabled = false;
  elements.typingInput.value = "";
  elements.typingInput.focus();

  // 進捗情報を復元
  gameState.isRunning = true;
  gameState.startTime = Date.now() - gameState.elapsedTime * 1000;

  loadCurrentSentence();
  updateProgress();
  updateTimerDisplay();
  elements.accuracyDisplay.textContent = `${calculateAccuracy()}%`;
  elements.speedDisplay.textContent = calculateSpeed();

  // タイマー開始
  gameState.timer = setInterval(() => {
    gameState.elapsedTime = Math.floor(
      (Date.now() - gameState.startTime) / 1000
    );
    updateTimerDisplay();
  }, 100);

  showToast("info", "進捗を復元しました");
}

// テキスト解析
async function processText() {
  const text = elements.textMaterial.value.trim();

  if (!text) {
    alert("テキストを入力またはファイルをアップロードしてください");
    return;
  }

  try {
    let processedText = text;
    const useSegmenter = elements.useSegmenterCheckbox.checked;
    const filterPattern = elements.filterPatternInput.value.trim();
    const filterReplacement = elements.filterReplacementInput.value;
    const splitPattern = elements.splitPatternInput.value.trim();

    // 1. フィルタ処理（置換）
    if (filterPattern) {
      try {
        const filterRegex = new RegExp(filterPattern, "g");
        processedText = processedText.replace(filterRegex, filterReplacement);
      } catch (regexError) {
        console.error("フィルタパターンエラー:", regexError);
        showToast("error", "フィルタパターンが無効です");
        return;
      }
    }

    // 2. 分割パターンで分割
    let sentences = [];
    if (splitPattern) {
      try {
        const splitRegex = new RegExp(splitPattern, "g");
        const parts = processedText.split(splitRegex);
        sentences = parts.filter(part => part.trim().length > 0);
      } catch (regexError) {
        console.error("分割パターンエラー:", regexError);
        showToast("error", "分割パターンが無効です");
        return;
      }
    } else {
      // 分割パターンがない場合は全体を1つとして扱う
      sentences = [processedText];
    }

    // 3. TextSegmenterでさらに分割
    if (useSegmenter) {
      const segmenter = new Intl.Segmenter("ja", { granularity: "sentence" });
      const furtherSplit = [];
      
      for (const sentence of sentences) {
        const segments = segmenter.segment(sentence);
        const segmented = Array.from(segments)
          .map((segment) => segment.segment.trim())
          .filter((s) => s.length > 0);
        furtherSplit.push(...segmented);
      }
      
      sentences = furtherSplit;
    }

    // 短すぎる文は除外（1文字以下）
    gameState.originalSentences = sentences
      .map(s => s.trim())
      .filter((sentence) => sentence.length > 1);

    // 文章の順序を設定（初期状態は元の順序）
    gameState.sentences = [...gameState.originalSentences];

    // ハッシュを生成
    gameState.textHash = await generateTextHash(gameState.originalSentences);

    // 総文字数を計算
    const totalCharacters = gameState.sentences.reduce(
      (total, sentence) => total + sentence.length,
      0
    );

    // 予想時間を計算（タイピング速度を300文字/分と仮定）
    const estimatedMinutes = Math.ceil(totalCharacters / 300);

    // テキスト統計情報を表示
    elements.sentenceCount.textContent = gameState.sentences.length;
    elements.characterCount.textContent = totalCharacters;
    elements.estimatedTime.textContent = `${estimatedMinutes}分`;
    elements.textStats.style.display = "block";
    elements.totalSentences.textContent = gameState.sentences.length;

    // プレビューを表示
    displaySentencePreview();

    if (gameState.sentences.length === 0) {
      alert("有効な文章が見つかりませんでした。別のテキストを試してください。");
    }
  } catch (error) {
    console.error("テキスト処理エラー:", error);
    alert(
      "テキストの処理中にエラーが発生しました。ブラウザがIntl.Segmenterをサポートしているか確認してください。"
    );
  }
}

// 文章プレビューを表示
function displaySentencePreview() {
  elements.sentencePreviewList.innerHTML = "";
  
  gameState.sentences.forEach((sentence, index) => {
    const item = document.createElement("div");
    item.className = "sentence-preview-item";
    
    const number = document.createElement("span");
    number.className = "sentence-preview-number";
    number.textContent = `${index + 1}.`;
    
    const text = document.createElement("span");
    text.className = "sentence-preview-text";
    text.textContent = sentence;
    
    item.appendChild(number);
    item.appendChild(text);
    elements.sentencePreviewList.appendChild(item);
  });
  
  elements.previewContainer.style.display = "block";
}

// ファイルアップロード処理
function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    elements.textMaterial.value = e.target.result;
  };
  reader.onerror = () => {
    alert("ファイルの読み込みに失敗しました");
  };
  reader.readAsText(file);
}

// ゲーム開始
function startGame() {
  if (gameState.sentences.length === 0) {
    alert("テキストを解析してから開始してください");
    return;
  }

  // ランダム化設定を適用
  gameState.randomizeOrder = elements.randomOrderCheckbox.checked;
  if (gameState.randomizeOrder) {
    gameState.sentences = shuffleArray(gameState.originalSentences);
  } else {
    gameState.sentences = [...gameState.originalSentences];
  }

  gameState.isRunning = true;
  gameState.startTime = Date.now();
  gameState.elapsedTime = 0;
  gameState.totalTyped = 0;
  gameState.correctTyped = 0;
  gameState.currentIndex = 0;
  gameState.skippedSentences = 0;
  gameState.completedSentences = new Set();

  showScreen("game-screen");

  elements.accuracyDisplay.textContent = "0%";
  elements.speedDisplay.textContent = "0";
  elements.progressDisplay.textContent = "0%";
  elements.typingInput.disabled = false;
  elements.typingInput.value = "";
  elements.typingInput.focus();

  loadCurrentSentence();
  updateProgress();

  // タイマー開始
  gameState.timer = setInterval(() => {
    gameState.elapsedTime = Math.floor(
      (Date.now() - gameState.startTime) / 1000
    );
    updateTimerDisplay();
  }, 100);
}

// タイマー表示更新
function updateTimerDisplay() {
  const minutes = Math.floor(gameState.elapsedTime / 60);
  const seconds = gameState.elapsedTime % 60;
  elements.timerDisplay.textContent = `${minutes}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

// 現在の文章をロード
function loadCurrentSentence() {
  if (gameState.currentIndex >= gameState.sentences.length) {
    endGame();
    return;
  }

  gameState.currentSentence = gameState.sentences[gameState.currentIndex];
  elements.targetText.textContent = gameState.currentSentence;
  elements.typingInput.value = "";
  elements.currentSentenceIndex.textContent = gameState.currentIndex + 1;
  
  // 前後の文章を表示
  updateContextDisplay();
}

// 前後の文章を表示
function updateContextDisplay() {
  // 前の文章
  if (gameState.currentIndex > 0) {
    elements.contextTextBefore.textContent = gameState.sentences[gameState.currentIndex - 1];
  } else {
    elements.contextTextBefore.textContent = "";
  }
  
  // 次の文章
  if (gameState.currentIndex < gameState.sentences.length - 1) {
    elements.contextTextAfter.textContent = gameState.sentences[gameState.currentIndex + 1];
  } else {
    elements.contextTextAfter.textContent = "";
  }
}

// 次の文章へスキップ
function skipCurrentSentence() {
  if (!gameState.isRunning) return;

  gameState.skippedSentences++;
  gameState.currentIndex++;
  updateProgress();

  // 進捗を保存
  saveProgress();

  // トースト通知を表示
  showToast("info", "スキップしました");

  loadCurrentSentence();
}

// 前の文章に戻る
function goToPreviousSentence() {
  if (!gameState.isRunning) return;
  if (gameState.currentIndex <= 0) return; // 最初の文章の場合は何もしない

  // 現在の文章を未完了に戻す
  gameState.completedSentences.delete(gameState.currentIndex);
  
  // 前の文章に戻る
  gameState.currentIndex--;
  
  // 前の文章も未完了に戻す
  gameState.completedSentences.delete(gameState.currentIndex);
  
  updateProgress();

  // 進捗を保存
  saveProgress();

  // トースト通知を表示
  showToast("info", "前の文章に戻りました");

  loadCurrentSentence();
}

// 進捗バー更新
function updateProgress() {
  const progress = Math.round(
    (gameState.currentIndex / gameState.sentences.length) * 100
  );
  elements.progressBar.style.width = `${progress}%`;
  elements.progressDisplay.textContent = `${progress}%`;
}

// ゲーム終了
function endGame() {
  clearInterval(gameState.timer);
  gameState.isRunning = false;
  elements.typingInput.disabled = true;

  // 進捗データを削除（ゲーム完了時）
  if (gameState.textHash) {
    clearProgress(gameState.textHash);
    // URLパラメータも削除
    window.history.replaceState({}, "", window.location.pathname);
  }

  // 結果画面の表示
  showScreen("result-screen");

  // 最終結果を表示
  const finalMinutes = Math.floor(gameState.elapsedTime / 60);
  const finalSeconds = gameState.elapsedTime % 60;
  elements.finalTime.textContent = `${finalMinutes}:${finalSeconds
    .toString()
    .padStart(2, "0")}`;
  elements.finalAccuracy.textContent = `${calculateAccuracy()}%`;
  elements.finalSpeed.textContent = calculateSpeed();
  elements.finalTotalTyped.textContent = gameState.totalTyped;
  elements.finalCorrectTyped.textContent = gameState.correctTyped;
}

// 正確さを計算
function calculateAccuracy() {
  if (gameState.totalTyped === 0) return 0;
  return Math.floor((gameState.correctTyped / gameState.totalTyped) * 100);
}

// 入力速度を計算（文字/分）
function calculateSpeed() {
  const minutesElapsed = gameState.elapsedTime / 60;
  if (minutesElapsed === 0) return 0;
  return Math.floor(gameState.totalTyped / minutesElapsed);
}

// 入力テキストの検証 (パフォーマンス最適化版)
function checkInput() {
  if (!gameState.isRunning || gameState.isComposing) return;

  const typedText = elements.typingInput.value;

  // 正しい入力が完了した場合
  if (typedText === gameState.currentSentence) {
    // トースト通知を表示
    showToast("success", "正解！");

    // 完了した文章を記録
    gameState.completedSentences.add(gameState.currentIndex);

    // 次の文章へ移動
    gameState.currentIndex++;
    updateProgress();
    
    // 進捗を保存
    saveProgress();
    
    loadCurrentSentence();

    return;
  }

  // 部分的に正しい入力の表示を最適化
  const targetElement = elements.targetText;

  // より効率的なDOM操作のために一時的な文字列を構築
  let html = "";
  const currentSentence = gameState.currentSentence;

  for (let i = 0; i < currentSentence.length; i++) {
    if (i < typedText.length) {
      if (typedText[i] === currentSentence[i]) {
        html += `<span class="correct">${currentSentence[i]}</span>`;
      } else {
        html += `<span class="incorrect">${currentSentence[i]}</span>`;
      }
    } else {
      html += currentSentence[i];
    }
  }

  // 一度だけDOMを更新
  targetElement.innerHTML = html;

  // 入力統計を更新
  elements.accuracyDisplay.textContent = `${calculateAccuracy()}%`;
  elements.speedDisplay.textContent = calculateSpeed();
}

// 最初の画面に戻る
function returnToSetup() {
  showScreen("setup-screen");
  // URLパラメータからハッシュを削除
  window.history.replaceState({}, "", window.location.pathname);
}

// ゲーム中に設定画面に戻る
function returnToSetupDuringGame() {
  if (gameState.isRunning) {
    clearInterval(gameState.timer);
    gameState.isRunning = false;
  }
  showScreen("setup-screen");
  // URLパラメータからハッシュを削除
  window.history.replaceState({}, "", window.location.pathname);
}

// ゲームリセット
function restartGame() {
  clearInterval(gameState.timer);
  startGame();
}

// 同じテキストで再挑戦
function retryGame() {
  // ランダム化設定を考慮して文章を再設定
  if (gameState.randomizeOrder) {
    gameState.sentences = shuffleArray(gameState.originalSentences);
  }

  showScreen("game-screen");
  gameState.currentIndex = 0;
  startGame();
}

// イベントリスナー
elements.processTextBtn.addEventListener("click", processText);
elements.fileUpload.addEventListener("change", handleFileUpload);
elements.startGameBtn.addEventListener("click", startGame);
elements.restartBtn.addEventListener("click", restartGame);
elements.returnSetupBtn.addEventListener("click", returnToSetupDuringGame);
elements.retryBtn.addEventListener("click", retryGame);
elements.returnBtn.addEventListener("click", returnToSetup);

// splitter設定変更時にプレビューを自動更新
const debouncedProcessText = debounce(processText, 300);
elements.splitPatternInput.addEventListener("input", debouncedProcessText);
elements.useSegmenterCheckbox.addEventListener("change", processText);

// 通常の入力処理
elements.typingInput.addEventListener("input", () => {
  if (!gameState.isComposing) {
    gameState.totalTyped++;
    if (
      elements.typingInput.value[elements.typingInput.value.length - 1] ===
      gameState.currentSentence[elements.typingInput.value.length - 1]
    ) {
      gameState.correctTyped++;
    }
    // 進捗を保存
    saveProgress();
    // 入力の検証をすぐに実行
    checkInput();
  }
});

// タブキーでスキップ、Shift + タブで前に戻る（IME入力中は無効）
elements.typingInput.addEventListener("keydown", (e) => {
  if (e.key === "Tab" && !gameState.isComposing) {
    e.preventDefault(); // デフォルトのタブ動作を防止
    
    if (e.shiftKey) {
      // Shift + Tab で前に戻る
      goToPreviousSentence();
    } else {
      // Tab でスキップ
      skipCurrentSentence();
    }
  }
});

// IME関連のイベント処理
elements.typingInput.addEventListener("compositionstart", () => {
  gameState.isComposing = true;
  elements.compositionStatus.textContent = "IME入力中...";
});

elements.typingInput.addEventListener("compositionupdate", (e) => {
  elements.compositionStatus.textContent = `IME入力中: ${e.data}`;
});

elements.typingInput.addEventListener("compositionend", (e) => {
  gameState.isComposing = false;
  elements.compositionStatus.textContent = ""; // 即時クリア

  // 確定された文字数分だけカウント
  gameState.totalTyped += e.data.length;

  // 正しい文字数をカウント
  const currentPosition = elements.typingInput.value.length - e.data.length;
  for (let i = 0; i < e.data.length; i++) {
    if (gameState.currentSentence[currentPosition + i] === e.data[i]) {
      gameState.correctTyped++;
    }
  }

  // 進捗を保存
  saveProgress();

  // 入力検証を即時実行（遅延なし）
  checkInput();
});

// ページ読み込み時にURLパラメータから進捗を復元
window.addEventListener("DOMContentLoaded", () => {
  loadFromURL();
});