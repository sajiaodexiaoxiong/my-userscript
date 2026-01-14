// ==UserScript==
// @name         自动批量查询(2秒等待)z fold 7 蓝色 512G 0.42
// @namespace    http://tampermonkey.net/
// @version      0.42
// @description  随机查询
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

    // 配置
    const BATCH_SIZE = 30;
    const DELAY_TIME = 5000; // 10秒等待，load 2秒
    const DELAY_START = 5;
    const DELAY_END = 15;
    const BATCH_SIZE_START = 20;
    const BATCH_SIZE_END = 31;
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
        //if (document.getElementById('usps-auto-ui')) return;

        const ui = document.createElement('div');
        ui.id = 'usps-auto-ui';
        ui.style.cssText = `
            position: fixed; top: 20px; right: 20px; z-index: 9999;
            background: white; padding: 15px; border: 1px solid #ddd;
            border-radius: 5px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            font-family: Arial, sans-serif; width: 300px;
        `;

        ui.innerHTML = `
            <h3 style="margin-top:0;color:#d04349;">自动查询 z fold 7 蓝色 512G</h3>
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
                <span>结果: <span id="usps-error-count">0</span></span>
            </div>
            <div id="usps-auto-download-container" style="margin-top:10px;">
                <button id="usps-auto-download" style="width:100%;padding:8px;background:#28a745;color:white;border:none;border-radius:4px;" disabled>下载日志</button>
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
        const currentUrl = window.location.href;
        GM_setValue('lastUrl', currentUrl);
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
        GM_setValue('usps_auto_processing', false);
        GM_setValue('usps_firstStart', true);
		GM_setValue('usps_error_tracking_numbers', []);

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
        //if (!isProcessing) return;
        if (!isProcessing)
        {
            updateCounts();
            return;
        }

        if (pendingTrackingNumbers.length === 0) {
            finishProcessing();
            return;
        }

        var size = getRandom(BATCH_SIZE_START,BATCH_SIZE_END);
        const batch = pendingTrackingNumbers.slice(0, size);
        updateStatus('正在处理 ' + (allTrackingNumbers.length - pendingTrackingNumbers.length + 1) +
                     '-' + (allTrackingNumbers.length - pendingTrackingNumbers.length + batch.length) +
                     '/' + allTrackingNumbers.length);

        // 更新待处理列表
        pendingTrackingNumbers = pendingTrackingNumbers.slice(size);
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
                // 如果没有找到，等待若干秒秒后重试
                setTimeout(() => waitForElements(batch, retries - 1), getRandom(DELAY_START,DELAY_END)*1000);
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

        const currentUrl = window.location.href;
        GM_setValue('lastUrl', currentUrl);

        clearCookies1();
        // 提交查询
        button.click();
        //setTimeout(() => button.click(), getRandom(1,5)*1000);

    }
    // 完成处理
    function finishProcessing() {
        isProcessing = false;
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
            const errorElements = document.querySelectorAll('.red-banner, .green-banner, .blue-banner');
			errorTrackingNumbers = GM_getValue('usps_error_tracking_numbers', []);
            errorElements.forEach(errorElement => {
                let status='红色';
                if (errorElement.classList.contains('red-banner')) {
                    status='红色';
                } else if (errorElement.classList.contains('green-banner')) {
                     status='绿色';
                } else if (errorElement.classList.contains('blue-banner')) {
                     status='蓝色';
                }
                const parent = errorElement.closest('.product_summary');
                const trackingNumber = parent ? parent.querySelector('.tracking-number') : null;
                const statusEl = parent ? parent.querySelector('h3.banner-header')?.textContent.trim(): null;

                let bannerMessage = null;
                if (parent) {
                    if (statusEl === "Expected Delivery Date") {
                        // 提取 <p class="banner-content"> 的文本
                        const bannerContent = parent.querySelector('p.banner-content');
                        bannerMessage = bannerContent ? bannerContent.textContent.replace(/\s+/g, ' ').trim() : null;
                    } else {
                        // 默认情况，提取所有 <p> 标签内容
                        bannerMessage = Array.from(parent.querySelector('h3.banner-header')?.parentElement?.children || []).filter(el => el.tagName === 'P').map(p => p.textContent.replace(/\s+/g, ' ').trim()).join(' ');
                    }
                }
				//const bannerMessage =parent ? Array.from(parent.querySelector('h3.banner-header')?.parentElement?.children || []).filter(el => el.tagName === 'P').map(p => p.textContent.replace(/\s+/g, ' ').trim()).join(' '):null;
                if (trackingNumber) {
                    const errorTrackingNumber = trackingNumber.textContent.trim();
					// 检查是否已存在，避免重复
					const exist = errorTrackingNumbers.some(obj => obj.trackingNumber === errorTrackingNumber);
					if (!exist) {
						errorTrackingNumbers.push({
							trackingNumber:errorTrackingNumber,
                            status: status,
							statusText: statusEl,
							message: bannerMessage
						});
					}
                }
            });

			GM_setValue('usps_error_tracking_numbers', errorTrackingNumbers);
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

	// 下载错误日志（生成 Excel 文件 .xls）
	function downloadErrors() {
		const errorMap = GM_getValue('usps_error_tracking_numbers', []);
		const rows = [["Tracking Number", "Status","StatusText", "Message"]];

		for (const [tn, info] of Object.entries(errorMap)) {
			rows.push([
				`="${info.trackingNumber}"`,
				info.status || "",
                info.statusText || "",
				info.message || ""
			]);
		}

		// 构建 HTML 表格
		const tableHtml = `
			<table border="1">
				${rows.map(row => `
					<tr>${row.map(cell => `<td style="white-space:nowrap; width:250px">${String(cell)
						.replace(/&/g, '&amp;')
						.replace(/</g, '&lt;')
						.replace(/>/g, '&gt;')
						.replace(/"/g, '&quot;')}</td>`).join('')}
					</tr>
				`).join('')}
			</table>
		`;

		// 构建 Excel 文件格式
		const html = `
			<html xmlns:o="urn:schemas-microsoft-com:office:office"
				xmlns:x="urn:schemas-microsoft-com:office:excel"
				xmlns="http://www.w3.org/TR/REC-html40">
				<head>
					<meta charset="UTF-8">
					<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
					<x:Name>Sheet1</x:Name>
					<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
					</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
				</head>
				<body>${tableHtml}</body>
			</html>
		`;

		// 生成 Blob 并下载
		const blob = new Blob([html], { type: "application/vnd.ms-excel" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "tracking_numbers.xls";
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

    // 页面加载完成后恢复状态
    window.addEventListener('load', function() {
        initUI();
        setTimeout(restoreState, getRandom(10,15)*1000);
    });

    //清除cookie
    function clearCookies()
    {
        // 获取当前页面的域名
        var domain = window.location.hostname;

        // 清除当前域下的所有 cookies
        document.cookie.split(";").forEach(function(c) {
            var cookieName = c.trim().split("=")[0];
            document.cookie = cookieName + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=" + domain;
        });

        // 获取当前时间
        var currentTime = new Date().getTime();
        var clearMinute = getRandom(3,5);

        // 计算下次清理时间（当前时间 + 随机的分钟数）
        var nextClearTime = currentTime + (clearMinute * 60 * 1000);

        // 更新清理时间戳，设置下次清理的时间
        localStorage.setItem('lastClearedTime', nextClearTime);
        // 可选：刷新页面，以便重新开始会话
        location.replace(location.href);
    }

	function clearCookies1()
    {
        // 获取当前页面的域名
        var domain = window.location.hostname;

        // 清除当前域下的所有 cookies
        document.cookie.split(";").forEach(function(c) {
            var cookieName = c.trim().split("=")[0];
            document.cookie = cookieName + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=" + domain;
        });
    }

    function checkCookie()
    {
        // 获取当前时间
        var currentTime = new Date().getTime();
        // 从 localStorage 获取上次清理的时间
        var lastClearedTime = localStorage.getItem('lastClearedTime');

        //判断是否需要清理 cookies
        if (!lastClearedTime || currentTime - lastClearedTime >= 0) {
            clearCookies();
        } else {
            console.log("无需清理 Cookies，等待下次清理");
        }
    }

    // 检查服务异常
    function checkServiceError() {
        const currentUrl = window.location.href;
        return currentUrl.includes('server_responses') || currentUrl.includes('anyapp_outage_apology');
    }

    // 恢复状态
    async function restoreState() {

		//checkCookie();
        //if(checkServiceError())
        //{
        //    console.log("服务器查询异常...");
        //    const currentUrl = GM_getValue('usps_auto_pending_numbers', 'https://www.baidu.com');;
        //    location.replace(currentUrl);
        //}

        fileUploaded = GM_getValue('usps_auto_file_uploaded', false);
        if (fileUploaded) {
            const elementsLoaded = await waitForAllElements();
            if (elementsLoaded) {
                GM_setValue('usps_firstStart', false);
                firstStart = GM_getValue('usps_firstStart', true);
                allTrackingNumbers = GM_getValue('usps_auto_all_numbers', []);
                pendingTrackingNumbers = GM_getValue('usps_auto_pending_numbers', []);
                errorTrackingNumbers = Object.keys(GM_getValue('usps_error_tracking_numbers', []));
                updateStatus('已恢复 ' + allTrackingNumbers.length + ' 个跟踪号');
                var startButton = document.getElementById('usps-auto-start');
                var downloadButton = document.getElementById('usps-auto-download');
                if(startButton==null || downloadButton==null)
                {
                    location.replace(location.href);
                }
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

        const allElementsLoaded = input && button && uiContainer && fileInput && startButton && resetButton && downloadButton && status && pendingCount && processedCount && errorCount && progressBar;

		//const allElementsLoaded = input && button
        if (!allElementsLoaded && retries > 0) {
            await new Promise(resolve => setTimeout(resolve, getRandom(DELAY_START,DELAY_END)*1000));
            return await waitForAllElements(retries - 1);
        }

        if (!allElementsLoaded) {
            console.log("无法加载所有元素，刷新页面...");
            location.replace(location.href);
            return false;
        }

        return true;
    }
    function getRandom(DELAY_START,DELAY_END)
    {
        return Math.floor(Math.random() * (DELAY_END - DELAY_START)) + DELAY_START;
    }
})();
