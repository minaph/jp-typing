// ゲームの状態を管理
const gameState = {
  isRunning: false,
  startTime: 0,
  elapsedTime: 0,
  timer: null,
  committedChars: 0, // 文字数空間: 確定挿入文字数（速度計算用）
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

// 寄与判定カウンタ（打鍵数空間の正確率用）
const contribution = {
  positive: 0,  // 距離を縮めた編集（寄与）
  negative: 0,  // 距離を広げた編集（非寄与）
  neutral: 0,   // 距離が変わらなかった編集
};

// 打鍵数カウンタ（IME中/非IME中の打鍵数を積算）
let imeKeystrokes = 0;        // IME入力中の打鍵数
let keysSinceLastEdit = 0;    // 非IME時、直近編集までの打鍵数

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

/**
 * Levenshtein 距離 (編集距離) を求める関数
 * @param {string} a — 文字列 A（長さ m）
 * @param {string} b — 文字列 B（長さ n）
 * @returns {number} — A → B に変換するための最小編集操作数
 */
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;

  // 特殊ケース: どちらかが空文字列なら、もう一方の長さ分挿入／削除操作
  if (m === 0) return n;
  if (n === 0) return m;

  // DP 行列 d を (m+1) × (n+1) サイズで確保
  // d[i][j] = a の先頭 i 文字 → b の先頭 j 文字を変換する最小操作数
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  // 初期化：a を空文字列にするための削除コスト
  for (let i = 0; i <= m; i++) {
    d[i][0] = i;
  }
  // 初期化：空文字列を b にするための挿入コスト
  for (let j = 0; j <= n; j++) {
    d[0][j] = j;
  }

  // メインループ
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = (a[i - 1] === b[j - 1] ? 0 : 1);
      // 削除：d[i-1][j] + 1
      // 挿入：d[i][j-1] + 1
      // 置換：d[i-1][j-1] + cost
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
    }
  }

  // 結果：a 全体を b 全体に変換するコスト
  return d[m][n];
}

/**
 * 編集前後の距離差から寄与の符号だけを返す（+1:寄与, 0:中立, -1:非寄与）
 * @param {string} prevText — 編集前のテキスト
 * @param {string} nextText — 編集後のテキスト
 * @param {string} target — 目標テキスト
 * @returns {number} — 寄与の符号
 */
function getContributionSign(prevText, nextText, target) {
  const distBefore = levenshteinDistance(prevText, target);
  const distAfter = levenshteinDistance(nextText, target);
  return Math.sign(distBefore - distAfter);
}

/**
 * 打鍵数を寄与に配賦する（IME確定時や非IME編集時に使用）
 * @param {string} prevText — 編集前のテキスト
 * @param {string} nextText — 編集後のテキスト
 * @param {string} target — 目標テキスト
 * @param {number} keystrokes — 配賦する打鍵数
 */
function allocateKeystrokes(prevText, nextText, target, keystrokes) {
  const sign = getContributionSign(prevText, nextText, target);
  const k = Math.max(1, keystrokes); // 最低1として配賦
  
  if (sign > 0) {
    contribution.positive += k;
  } else if (sign < 0) {
    contribution.negative += k;
  } else {
    contribution.neutral += k;
  }
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
  productivityDisplay: document.getElementById("productivity-display"),
  progressBar: document.getElementById("progress-bar"),
  progressPercentage: document.getElementById("progress-percentage"),
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
    committedChars: gameState.committedChars,
    contributionPositive: contribution.positive,
    contributionNegative: contribution.negative,
    contributionNeutral: contribution.neutral,
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
  gameState.committedChars = progressData.committedChars ?? 0;
  contribution.positive = progressData.contributionPositive ?? 0;
  contribution.negative = progressData.contributionNegative ?? 0;
  contribution.neutral = progressData.contributionNeutral ?? 0;
  gameState.elapsedTime = progressData.elapsedTime;
  gameState.skippedSentences = progressData.skippedSentences;
  gameState.currentIndex = progressData.currentIndex;
  gameState.textHash = hash;
  
  // 打鍵カウンタをリセット（一時的な状態なので復元時は0から）
  imeKeystrokes = 0;
  keysSinceLastEdit = 0;

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
  elements.accuracyDisplay.textContent = calculateAccuracy();
  elements.speedDisplay.textContent = calculateSpeed();
  elements.productivityDisplay.textContent = calculateProductivity();

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

    // 予想時間を計算（タイピング速度を100文字/分と仮定）
    const estimatedMinutes = Math.ceil(totalCharacters / 100);

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
  gameState.committedChars = 0;
  gameState.currentIndex = 0;
  gameState.skippedSentences = 0;
  gameState.completedSentences = new Set();
  
  // 寄与カウンタをリセット
  contribution.positive = 0;
  contribution.negative = 0;
  contribution.neutral = 0;
  
  // 打鍵カウンタをリセット
  imeKeystrokes = 0;
  keysSinceLastEdit = 0;

  showScreen("game-screen");

  elements.accuracyDisplay.textContent = "0";
  elements.speedDisplay.textContent = "0";
  elements.productivityDisplay.textContent = "0";
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
  elements.progressPercentage.textContent = `${progress}%`;
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
  elements.finalTotalTyped.textContent = gameState.committedChars;
  elements.finalCorrectTyped.textContent = contribution.positive;
}

// 正確さを計算（寄与率：中立を除外した割合）
function calculateAccuracy() {
  const totalUsed = contribution.positive + contribution.negative;
  if (totalUsed === 0) return 0;
  return Math.floor((contribution.positive / totalUsed) * 100);
}

// 入力速度を計算（文字数空間：確定挿入文字数/分）
function calculateSpeed() {
  const minutesElapsed = gameState.elapsedTime / 60;
  if (minutesElapsed === 0) return 0;
  return Math.floor(gameState.committedChars / minutesElapsed);
}

// 生産性を計算（獲得文字数 / 打鍵数 * 100）
function calculateProductivity() {
  // 完了した文章の文字数の総和
  let completedChars = 0;
  for (const index of gameState.completedSentences) {
    if (gameState.sentences[index]) {
      completedChars += gameState.sentences[index].length;
    }
  }
  
  // 現在入力中の文章の進捗
  let currentProgress = 0;
  if (gameState.isRunning && gameState.currentSentence) {
    const currentInput = elements.typingInput.value;
    const targetLength = gameState.currentSentence.length;
    const distance = levenshteinDistance(currentInput, gameState.currentSentence);
    currentProgress = Math.max(0, targetLength - distance);
  }
  
  // 獲得文字数
  const earnedChars = completedChars + currentProgress;
  
  // 全打鍵数
  const totalKeystrokes = contribution.positive + contribution.negative + contribution.neutral;
  
  if (totalKeystrokes === 0) return 0;
  
  const text = (earnedChars / totalKeystrokes).toFixed(2);
  if (text[0] === '0') {
    return text.slice(1);
  }
  return text;
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
  elements.accuracyDisplay.textContent = calculateAccuracy();
  elements.speedDisplay.textContent = calculateSpeed();
  elements.productivityDisplay.textContent = calculateProductivity();
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
elements.filterPatternInput.addEventListener("input", debouncedProcessText);
elements.filterReplacementInput.addEventListener("input", debouncedProcessText);
elements.useSegmenterCheckbox.addEventListener("change", processText);

// beforeinput: 確定編集イベント（insert/delete/paste等）で寄与判定
elements.typingInput.addEventListener("beforeinput", (e) => {
  if (!gameState.isRunning || gameState.isComposing) return;

  const inputElement = elements.typingInput;
  const prevText = inputElement.value;
  const target = gameState.currentSentence;
  
  // カーソル位置と選択範囲を取得
  const selStart = inputElement.selectionStart ?? 0;
  const selEnd = inputElement.selectionEnd ?? 0;
  
  let nextText = prevText;
  let insertedCharCount = 0;

  // 入力タイプに応じて編集後テキストを予測
  if (e.inputType === "insertText" || e.inputType === "insertFromPaste") {
    const inserted = e.data ?? "";
    nextText = prevText.slice(0, selStart) + inserted + prevText.slice(selEnd);
    insertedCharCount = inserted.length;
  } else if (e.inputType === "deleteContentBackward") {
    // バックスペース
    const delStart = selStart === selEnd ? Math.max(selStart - 1, 0) : selStart;
    nextText = prevText.slice(0, delStart) + prevText.slice(selEnd);
  } else if (e.inputType === "deleteContentForward") {
    // Delete キー
    const delEnd = selStart === selEnd ? Math.min(selEnd + 1, prevText.length) : selEnd;
    nextText = prevText.slice(0, selStart) + prevText.slice(delEnd);
  } else if (e.inputType === "insertCompositionText") {
    // composition中の一時挿入は無視（compositionendで処理）
    return;
  } else {
    // その他の編集タイプ（改行、カット等）
    // デフォルトでは変化なしとして扱う（必要に応じて対応追加）
    return;
  }

  // 打鍵数ベースの寄与配賦（非IME時）
  allocateKeystrokes(prevText, nextText, target, keysSinceLastEdit);
  keysSinceLastEdit = 0; // リセット
  
  // 確定挿入文字数をカウント（挿入系のみ）
  if (insertedCharCount > 0) {
    gameState.committedChars += insertedCharCount;
  }
});

// input: 表示更新と進捗保存のみ（カウントはbeforeinputで実施済み）
elements.typingInput.addEventListener("input", () => {
  if (!gameState.isComposing) {
    // 進捗を保存
    saveProgress();
    // 入力の検証をすぐに実行
    checkInput();
  }
});

// 打鍵数カウント（全てのキー操作を許容）
elements.typingInput.addEventListener("keydown", (e) => {
  if (!gameState.isRunning) return;
  
  // タブキーでのスキップ処理は除外（後続のハンドラで処理）
  if (e.key === "Tab" && !gameState.isComposing) {
    return;
  }
  
  // IME中か非IME中かで振り分け
  if (gameState.isComposing) {
    imeKeystrokes++;
  } else {
    keysSinceLastEdit++;
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
  imeKeystrokes = 0; // IME開始時にリセット
  elements.compositionStatus.textContent = "IME入力中...";
});

elements.typingInput.addEventListener("compositionupdate", (e) => {
  elements.compositionStatus.textContent = `IME入力中: ${e.data}`;
});

elements.typingInput.addEventListener("compositionend", (e) => {
  gameState.isComposing = false;
  elements.compositionStatus.textContent = ""; // 即時クリア

  if (!gameState.isRunning) return;

  const inputElement = elements.typingInput;
  const afterText = inputElement.value;
  const insertedLength = e.data?.length ?? 0;
  const beforeText = afterText.slice(0, afterText.length - insertedLength);
  
  // 打鍵数ベースの寄与配賦（IME確定時）
  allocateKeystrokes(beforeText, afterText, gameState.currentSentence, imeKeystrokes);
  imeKeystrokes = 0; // リセット
  
  // 確定挿入文字数をカウント（速度計算用）
  gameState.committedChars += insertedLength;

  // 進捗を保存
  saveProgress();

  // 入力検証を即時実行（遅延なし）
  checkInput();
  
  // 生産性を更新
  elements.productivityDisplay.textContent = calculateProductivity();
});

// ページ読み込み時にURLパラメータから進捗を復元
window.addEventListener("DOMContentLoaded", () => {
  loadFromURL();
});