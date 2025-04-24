// ==UserScript==
// @name         自动批量查询(2秒等待)1.3加强版
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  每次查询后等待2秒
// @match        https://tools.usps.com/go/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_download
// @run-at       document-end
// @updateURL    https://github.com/sajiaodexiaoxiong/my-userscript/raw/refs/heads/main/myscript.user.js
// @downloadURL  https://github.com/sajiaodexiaoxiong/my-userscript/raw/refs/heads/main/myscript.user.js
// ==/UserScript==

(function() {
    'use strict';
    123
    // 配置
    const BATCH_SIZE = 30;
    const DELAY_TIME = 2000; // 2秒等待，load 2秒
    const TRACKING_INPUT_SELECTOR = '#tracking-input';
    const SEARCH_BUTTON_SELECTOR = '.tracking-btn-srch';

    // 状态管理
    let allTrackingNumbers = [];   // 所有跟踪号
    let pendingTrackingNumbers = []; // 待处理跟踪号
    let errorTrackingNumbers = [];   // 错误的跟踪号
    let isProcessing = false;
    let fileUploaded = false;
    let firstStart = true;

    // 初始化UI
    function initUI() {
        if (document.getElementById('usps-auto-ui')) return;

        const ui = document.createElement('div');
        ui.id = 'usps-auto-ui';
        ui.style.cssText = `
            position: fixed; top: 20px; right: 20px; z-index: 9999;
            background: white; padding: 15px; border: 1px solid #ddd;
            border-radius: 5px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            font-family: Arial, sans-serif; width: 300px;
        `;

        ui.innerHTML = `
            <h3 style="margin-top:0;color:#d04349;">自动查询 v1.3加强版</h3>
            <input type="file" id="usps-auto-file" accept=".txt" style="width:100%;margin-bottom:10px;">
            <div style="display:flex;gap:10px;margin-bottom:10px;">
                <button id="usps-auto-start" style="flex:1;padding:8px;background:#d04349;color:white;border:none;border-radius:4px;">开始</button>
                <button id="usps-auto-reset" style="flex:1;padding:8px;background:#666;color:white;border:none;border-radius:4px;">初始化</button>
            </div>
            <div id="usps-auto-status" style="margin-top:10px;font-size:13px;color:#666;">
                等待上传文件...
            </div>
            <div style="margin-top:10px;height:4px;background:#eee;border-radius:2px;">
                <div id="usps-auto-progress" style="height:100%;width:0%;background:#d04349;border-radius:2px;"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:5px;">
                <span>待处理: <span id="usps-pending-count">0</span></span>
                <span>已处理: <span id="usps-processed-count">0</span></span>
                <span>错误: <span id="usps-error-count">0</span></span>
            </div>
            <div id="usps-auto-download-container" style="margin-top:10px;">
                <button id="usps-auto-download" style="width:100%;padding:8px;background:#28a745;color:white;border:none;border-radius:4px;" disabled>下载错误日志</button>
            </div>
        `;

        document.body.appendChild(ui);

        // 事件监听
        document.getElementById('usps-auto-file').addEventListener('change', handleFileUpload);
        document.getElementById('usps-auto-start').addEventListener('click', startProcessing);
        document.getElementById('usps-auto-reset').addEventListener('click', resetAll);
        document.getElementById('usps-auto-download').addEventListener('click', downloadErrors);

        fileUploaded = GM_getValue('usps_auto_file_uploaded', false);
        if(fileUploaded){
            document.getElementById('usps-auto-start').disabled = true;
        }
        else{
            document.getElementById('usps-auto-start').disabled = false;
        }
        isProcessing = GM_getValue('usps_auto_processing', false);
    }

    // 处理文件上传
    function handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            allTrackingNumbers = e.target.result.split(/[\n,]+/).map(t => t.trim()).filter(t => t.length > 0);
            allTrackingNumbers = [...new Set(allTrackingNumbers)]; // 去重
            pendingTrackingNumbers = [...allTrackingNumbers];

            fileUploaded = true;
            GM_setValue('usps_firstStart', true);
            GM_setValue('usps_auto_processing', true);
            GM_setValue('usps_auto_file_uploaded', true);
            GM_setValue('usps_auto_all_numbers', allTrackingNumbers);
            GM_setValue('usps_error_tracking_numbers', []);
            GM_setValue('usps_auto_pending_numbers', pendingTrackingNumbers);

            updateStatus('已加载 ' + allTrackingNumbers.length + ' 个跟踪号');
            document.getElementById('usps-auto-start').disabled = false;
            document.getElementById('usps-auto-download').disabled = false;
            isProcessing = false;
            updateCounts();
        };
        reader.readAsText(file);
    }

    // 开始处理
    function startProcessing() {
        isProcessing = GM_getValue('usps_auto_processing', false);
        if (!isProcessing || !fileUploaded) return;

        document.getElementById('usps-auto-start').disabled = true;
        document.getElementById('usps-auto-reset').disabled = true;
        document.getElementById('usps-auto-file').disabled = true;

        processNextBatch();
    }

    // 初始化所有状态
    function resetAll() {
        allTrackingNumbers = [];
        pendingTrackingNumbers = [];
        errorTrackingNumbers = [];
        isProcessing = false;
        fileUploaded = false;

        // 清空文件上传框
        document.getElementById('usps-auto-file').value = '';

        GM_setValue('usps_auto_file_uploaded', false);
        GM_setValue('usps_auto_all_numbers', []);
        GM_setValue('usps_auto_pending_numbers', []);
        GM_setValue('usps_error_tracking_numbers', []);
        GM_setValue('usps_auto_processing', false);
        GM_setValue('usps_firstStart', true);

        updateStatus('等待上传文件...');
        document.getElementById('usps-auto-start').disabled = false;
        document.getElementById('usps-auto-reset').disabled = false;
        document.getElementById('usps-auto-file').disabled = false;
        document.getElementById('usps-auto-download').disabled = false;
        updateCounts();
        updateProgress(0);
    }

    // 处理下一批
    function processNextBatch() {
        if (!isProcessing) return;

        if (pendingTrackingNumbers.length === 0) {
            finishProcessing();
            return;
        }

        const batch = pendingTrackingNumbers.slice(0, BATCH_SIZE);
        updateStatus('正在处理 ' + (allTrackingNumbers.length - pendingTrackingNumbers.length + 1) +
                     '-' + (allTrackingNumbers.length - pendingTrackingNumbers.length + batch.length) +
                     '/' + allTrackingNumbers.length);

        // 更新待处理列表
        pendingTrackingNumbers = pendingTrackingNumbers.slice(BATCH_SIZE);
        GM_setValue('usps_auto_pending_numbers', pendingTrackingNumbers);

        // 检查错误
        checkForErrors();

        // 填充并提交
        waitForElements(batch); // 使用 waitForElements 确保元素存在
    }

    // 等待元素加载并提交
    function waitForElements(batch, retries = 3) {
        const input = document.querySelector(TRACKING_INPUT_SELECTOR);
        const button = document.querySelector(SEARCH_BUTTON_SELECTOR);
        if (!input || !button) {
            if (retries > 0) {
                // 如果没有找到，等待1秒后重试
                setTimeout(() => waitForElements(batch, retries - 1), 1000);  // 重试3次，每次间隔1秒
                return;
            } else {
                // 如果重试次数用尽，刷新页面
                console.log("3找不到元素，刷新页面...");
                //location.reload();  // 刷新页面
                location.replace(location.href);  // 用替代方式模拟页面刷新
                return;
            }
        }

        // 找到元素后，继续执行后续操作
        input.value = batch.join(',');

        // 更新计数，放在这里确保点击之前更新
        updateCounts();  // 先更新计数信息

        // 提交查询
        button.click();
    }
    // 完成处理
    function finishProcessing() {
        isProcessing = false;
        GM_setValue('usps_auto_processing', false);
        GM_setValue('usps_auto_processing', false);
        updateStatus('处理完成！');
        document.getElementById('usps-auto-start').disabled = true;
        document.getElementById('usps-auto-reset').disabled = false;
        document.getElementById('usps-auto-file').disabled = false;
        checkForErrors();
        updateCounts();
    }

    // 检查页面上的错误
    function checkForErrors() {
        firstStart = GM_getValue('usps_firstStart', false);  //如果是第一次加载 页面上已经存在的数据就不要去检测了。
        if(!firstStart)
        {
            const errorElements = document.querySelectorAll('.red-banner');
            errorElements.forEach(errorElement => {
                const parent = errorElement.closest('.product_summary');
                const trackingNumber = parent ? parent.querySelector('.tracking-number') : null;
                if (trackingNumber) {
                    const errorTrackingNumber = trackingNumber.textContent.trim();
                    if (!errorTrackingNumbers.includes(errorTrackingNumber)) {
                        errorTrackingNumbers.push(errorTrackingNumber);
                        GM_setValue('usps_error_tracking_numbers', errorTrackingNumbers);
                    }
                }
            });

            // 更新错误计数
            updateErrorCount();
        }
    }

    // 更新状态
    function updateStatus(msg) {
        const el = document.getElementById('usps-auto-status');
        if (el) el.textContent = msg;
    }

    // 更新计数
    function updateCounts() {
        document.getElementById('usps-pending-count').textContent = pendingTrackingNumbers.length;
        document.getElementById('usps-processed-count').textContent = allTrackingNumbers.length - pendingTrackingNumbers.length;
        updateErrorCount();

        // 更新进度条
        const progress = ((allTrackingNumbers.length - pendingTrackingNumbers.length) / allTrackingNumbers.length) * 100;
        updateProgress(progress);
    }

    // 更新错误计数
    function updateErrorCount() {
        document.getElementById('usps-error-count').textContent = errorTrackingNumbers.length;
    }

    // 更新进度
    function updateProgress(percent) {
        const bar = document.getElementById('usps-auto-progress');
        if (bar) bar.style.width = percent + '%';
    }

    // 下载错误日志
    function downloadErrors() {
        const csvContent = "data:text/csv;charset=utf-8," + errorTrackingNumbers.join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', 'error_tracking_numbers.csv');
        document.body.appendChild(link);
        link.click();
    }

    // 页面加载完成后恢复状态
    window.addEventListener('load', function() {
        initUI();
        setTimeout(restoreState, DELAY_TIME);
    });

// 恢复状态
async function restoreState() {
    fileUploaded = GM_getValue('usps_auto_file_uploaded', false);
    if (fileUploaded) {
        const elementsLoaded = await waitForAllElements();
        if (elementsLoaded) {
            GM_setValue('usps_firstStart', false);
            firstStart = GM_getValue('usps_firstStart', true);
            allTrackingNumbers = GM_getValue('usps_auto_all_numbers', []);
            pendingTrackingNumbers = GM_getValue('usps_auto_pending_numbers', []);
            errorTrackingNumbers = GM_getValue('usps_error_tracking_numbers', []);
            updateStatus('已恢复 ' + allTrackingNumbers.length + ' 个跟踪号');
            document.getElementById('usps-auto-start').disabled = false;
            document.getElementById('usps-auto-download').disabled = false;
            processNextBatch();
        } else {
            console.log("页面元素加载失败...");
        }
    }
}

// 等待页面元素加载完毕
async function waitForAllElements(retries = 3) {
    const uiContainer = document.getElementById('usps-auto-ui');
    const fileInput = document.getElementById('usps-auto-file');
    const startButton = document.getElementById('usps-auto-start');
    const resetButton = document.getElementById('usps-auto-reset');
    const downloadButton = document.getElementById('usps-auto-download');
    const status = document.getElementById('usps-auto-status');
    const pendingCount = document.getElementById('usps-pending-count');
    const processedCount = document.getElementById('usps-processed-count');
    const errorCount = document.getElementById('usps-error-count');
    const progressBar = document.getElementById('usps-auto-progress');
    const input = document.querySelector(TRACKING_INPUT_SELECTOR);
    const button = document.querySelector(SEARCH_BUTTON_SELECTOR);

    const allElementsLoaded = input && button && uiContainer && fileInput && startButton && resetButton && downloadButton &&
                              status && pendingCount && processedCount && errorCount && progressBar;

    if (!allElementsLoaded && retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return await waitForAllElements(retries - 1);
    }

    if (!allElementsLoaded) {
        console.log("无法加载所有元素，刷新页面...");
        location.replace(location.href);
        return false;
    }

    return true;
}
})();
