let ALLOW_PARAM_OVERRIDE_FROM_URL = true;
let ROOT = "/root";
let STORAGE_INDEXED_DB = "INDEXED_DB";
let STORAGE_MEMORY = "MEMORY";

let DEFAULT_AUTO_RUN = true;
let DEFAULT_LOAD_DESKTOP = false;
let DEFAULT_SOUND_ENABLED = true;
let DEFAULT_DISABLE_HIDE_CURSOR = false;
let DEFAULT_APP_DIRECTORY = "/home/username/.wine/dosdevices/c:/files";
let DEFAULT_BPP = 32; // was 20 (invalid depth, not 8/16/32) - 16 balances speed and visual quality
let DEFAULT_FRAME_SKIP = "0";
let DEFAULT_ROOT_ZIP_FILE = "boxedwine.zip";

// --- Display settings ---
// The game's cnc-ddraw config (ddraw.ini, shipped inside Beta.zip) creates a
// 570x320 window. The Wine desktop and the canvas backbuffer must use that exact
// size, otherwise the game window sits in a bigger desktop (black gutter and a
// mouse offset). The canvas is then scaled with CSS to fill the viewport.
let GAME_WIDTH = 800;
let GAME_HEIGHT = 450;
let DEBUG_LOG = /(?:^|[?&])debug=true(?:&|$)/.test(window.location.search);
let DISPLAY_WIDTH = GAME_WIDTH;
let DISPLAY_HEIGHT = GAME_HEIGHT;

var lastFit = "";

function fitCanvasToViewport() {
    var canvas = document.getElementById('canvas');
    if (!canvas) return;
    var w = canvas.width || DISPLAY_WIDTH;
    var h = canvas.height || DISPLAY_HEIGHT;
    var vw = document.documentElement.clientWidth || window.innerWidth || w;
    var vh = document.documentElement.clientHeight || window.innerHeight || h;
    if (vw < 1 || vh < 1 || w < 1 || h < 1) return;

    var scale = Math.min(vw / w, vh / h);
    var key = w + "x" + h + "@" + vw + "x" + vh;
    if (key === lastFit) return;
    lastFit = key;

    // Pin the layout box to the emulator's backbuffer and do the screen fit with
    // a transform. boxedwine writes its own inline width/height (sometimes with
    // !important) while it boots, and that is what used to fight the page CSS,
    // stretch the picture and crop it. A transform is ignored by the emulator, so
    // the rendered image is always the whole frame, aspect-correct and centred.
    canvas.style.setProperty("width", w + "px", "important");
    canvas.style.setProperty("height", h + "px", "important");
    canvas.style.transformOrigin = "center center";
    canvas.style.transform = "scale(" + scale + ")";

    // integer upscales stay crisp; fractional ones look better smoothed
    var fraction = Math.abs(scale - Math.round(scale));
    canvas.style.imageRendering = (scale >= 1.5 && fraction < 0.02) ? "pixelated" : "auto";
}

function installCanvasFit() {
    fitCanvasToViewport();
    window.addEventListener("resize", fitCanvasToViewport);
    window.addEventListener("orientationchange", fitCanvasToViewport);
    document.addEventListener("fullscreenchange", fitCanvasToViewport);
    document.addEventListener("webkitfullscreenchange", fitCanvasToViewport);
    var canvas = document.getElementById('canvas');
    if (canvas && window.MutationObserver) {
        // boxedwine resizes the backbuffer to the emulated resolution at boot
        new MutationObserver(fitCanvasToViewport).observe(canvas, { attributes: true, attributeFilter: ["width", "height"] });
    }
    // boxedwine also writes inline CSS sizes of its own during boot; keep the
    // fitted transform applied on top of whatever it does. Cheap: it only writes
    // when something actually changed.
    setInterval(fitCanvasToViewport, 500);
}

function toggleFullscreen() {
    var el = document.documentElement;
    var active = document.fullscreenElement || document.webkitFullscreenElement;
    if (active) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else if (el.requestFullscreen || el.webkitRequestFullscreen) {
        (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    }
}

function installDisplayHandlers() {
    var canvas = document.getElementById('canvas');
    if (canvas) canvas.addEventListener("dblclick", toggleFullscreen);
    window.addEventListener("keydown", function(e) {
        var tag = (e.target && e.target.tagName) || "";
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        if (e.key === "f" || e.key === "F") toggleFullscreen();
    });
}

//params
let Config = {};
Config.locateRootBaseUrl = "";
Config.locateAppBaseUrl = "";
Config.locateOverlayBaseUrl = "";
Config.urlParams = "";
Config.storageMode = STORAGE_INDEXED_DB;
Config.persist_d_drive = false; // was true - avoids a second IDBFS sync pass on every autoPersist write
Config.showUploadDownload = false;
Config.WorkingDir = "";
Config.loadDesktop = false;
Config.appSubfolder = "";

var isRunning = false;
var ExeFileTimer = null;

var statusElement = document.getElementById('status');
var progressElement = document.getElementById('progress');
var spinnerElement = document.getElementById('spinner');
var dropzone = document.getElementById("dropzone");

function setConfiguration() {
    Config.appDirPrefix = DEFAULT_APP_DIRECTORY;
    Config.isAutoRunSet = getAutoRun();
    Config.loadDesktop = getLoadDesktop();
    Config.rootZipFile = getRootZipFile("root");
    Config.extraZipFiles = getZipFileList("overlay");
    Config.appZipFile = getAppZipFile("app");
    Config.appPayload = getPayload("app-payload"); 
    Config.extraPayload = getPayload("overlay-payload"); 
    Config.Program = getExecutable();
    Config.isSoundEnabled = getSound();
    Config.disableHideCursor = getDisableHideCursor();
    Config.bpp = getBitsPerPixel();
    Config.cpu = getCPU();
    Config.envProp = getEnvProp();
    Config.emEnvProps = getEmscriptenEnvProps();
    Config.frameSkip = getFrameSkip();
    Config.resolution = getResolution();
    Config.ddrawOverridePath = getDDrawOverridePath();
    Config.payloadZipFile = "Beta.zip";
    Config.d_drive = "/d_drive";
}

function allowParameterOverride() {
    return Config.urlParams.length > 0 ? true : ALLOW_PARAM_OVERRIDE_FROM_URL;
}

function getEmscriptenEnvProps() {
    var props = getParameter("em-env").trim();
    let allProps = [];
    if(allowParameterOverride() && props.length > 6) {
        if((props.startsWith("%22") && props.endsWith("%22")) || (props.startsWith('%27') && props.endsWith('%27'))){
            props = props.substring(3, props.length - 3);
            props = props.split('%20').join(' ');
            props.trim().split(";").forEach(function(item){
                let kv = item.split(":");
                if (kv.length == 2) {
                    let key = kv[0].trim();
                    let value = kv[1].trim();
                    let existingIndex = allProps.findIndex(v => v.key === key);
                    if (existingIndex > -1) allProps.splice(existingIndex, 1);
                    allProps.push({key: key, value: value});
                }
            });
        }else{
            console.log("EMSCRIPTEN ENV props parameter must be in quoted string");
        }
    }
    if(allProps.length > 0) {
        console.log("setting EMSCRIPTEN ENV props:");
        allProps.forEach(prop => console.log(prop.key + " = " + prop.value));
    }
    return allProps;
}

function getDDrawOverridePath() {
    var property = getParameter("ddrawOverride").trim();
    if(allowParameterOverride() && property.length > 0){
        if((property.startsWith("%22") && property.endsWith("%22")) || (property.startsWith('%27') && property.endsWith('%27'))){
            return property.substring(3, property.length - 3);
        }else{
            console.log("ddrawOverride path must be in quoted string");
        }
    }
    return null;
}

function getEnvProp() {
    var property = getParameter("env").trim();
    if(allowParameterOverride() && property.length > 6){
        if((property.startsWith("%22") && property.endsWith("%22")) || (property.startsWith('%27') && property.endsWith('%27'))){
            let kv = property.substring(3, property.length - 3).split(':');
            return '"' + kv[0].trim() + "=" + kv[1].trim() + '"';
        }else{
            console.log("ENV property must be in quoted string");
        }
    }
    return '';
}

function getCPU() {
    var cpu = getParameter("cpu");
    if(!allowParameterOverride() || (cpu !== "p2" && cpu !== "p3")){
        cpu = "";
    }
    if(cpu.length > 0) console.log("setting CPU to: "+cpu);
    return cpu;
}

function getResolution() {
    var requested = allowParameterOverride() ? getParameter("resolution") : "";
    var gameResolution = GAME_WIDTH + "x" + GAME_HEIGHT;
    if (requested.length > 0 && requested !== gameResolution) {
        // The guest window size comes from ddraw.ini inside the game zip, so a
        // different emulated resolution would only add black bars around it.
        console.log("ignoring ?resolution=" + requested + "; the game is fixed at " + gameResolution + " and is scaled to the screen");
    }
    DISPLAY_WIDTH = GAME_WIDTH;
    DISPLAY_HEIGHT = GAME_HEIGHT;
    console.log("setting Resolution to: " + gameResolution);
    return gameResolution;
}

function isNumber(num) {
    const result = Number(num);
    return !isNaN(result) && result > 0 && result < 2000;
}

function getFrameSkip() {
    var frameskip = getParameter("skipFrameFPS");
    if(!allowParameterOverride() || frameskip === "" || Number(frameskip) < 0 || Number(frameskip) > 50){
        frameskip = DEFAULT_FRAME_SKIP;
    }
    console.log("setting skipFrameFPS to: "+frameskip);
    return frameskip;
}

function getBitsPerPixel() {
    var bpp = getParameter("bpp");
    if(!allowParameterOverride() || (bpp !== "8" && bpp !== "16" && bpp !== "32")){
        bpp = DEFAULT_BPP;
    }else{
        bpp = parseInt(bpp, 10);
    }
    console.log("setting BPP to: "+bpp);
    return bpp;
}

function getAutoRun() {
    var auto = getParameter("auto");
    if(!allowParameterOverride()){
        auto = DEFAULT_AUTO_RUN;
    }else if(auto === "true" || auto === "false"){
        auto = (auto === "true");
    }else{
        auto = DEFAULT_AUTO_RUN;
    }
    console.log("setting auto run to: "+auto);
    return auto;
}        

function getLoadDesktop() {
    var loadDesktop = getParameter("desktop");
    if(!allowParameterOverride()){
        loadDesktop = DEFAULT_LOAD_DESKTOP;
    }else if(loadDesktop === "true" || loadDesktop === "false"){
        loadDesktop = (loadDesktop === "true");
    }else{
        loadDesktop = DEFAULT_LOAD_DESKTOP;
    }
    console.log("setting load Desktop to: "+loadDesktop);
    return loadDesktop;
}

function getPayload(param) {
    return allowParameterOverride() ? getParameter(param) : "";
}

function getSound() {
    var soundEnabled = getParameter("sound");
    if(!allowParameterOverride()){
        soundEnabled = DEFAULT_SOUND_ENABLED;
    }else if(soundEnabled === "true" || soundEnabled === "false"){
        soundEnabled = (soundEnabled === "true");
    }else{
        soundEnabled = DEFAULT_SOUND_ENABLED;
    }
    console.log("setting sound to: "+soundEnabled);
    return soundEnabled;
}

function getDisableHideCursor() {
    var disableHideCursor = getParameter("disableHideCursor");
    if (!allowParameterOverride()) {
        disableHideCursor = DEFAULT_DISABLE_HIDE_CURSOR;
    } else if (disableHideCursor === "true" || disableHideCursor === "false") {
        disableHideCursor = (disableHideCursor === "true");
        console.log("setting disableHideCursor to: " + disableHideCursor);
    } else {
        disableHideCursor = DEFAULT_DISABLE_HIDE_CURSOR;
    }            
    return disableHideCursor;
}

function getExecutable() {
    var prog = getParameter("p");
    if(!allowParameterOverride() || prog===""){
        console.log("not setting program to execute");
    }else{
        if((prog.startsWith("%22") && prog.endsWith("%22")) || (prog.startsWith('%27') && prog.endsWith('%27'))){
            prog = prog.substring(3, prog.length - 3);
        }
        prog = prog.split('%20').join(' ');
        console.log("setting program to execute to: "+prog);
    }
    return prog;
}

function getAppZipFile(param) {
    var filename = getParameter(param);
    if(!allowParameterOverride() || filename===""){
        console.log("not setting " + param + " zip file");
        return "";
    }
    if(!filename.endsWith(".zip")) filename += ".zip";
    console.log("setting " + param + " zip file to: "+filename);
    return filename;
}

function getRootZipFile(param) {
    var filename = getParameter(param);
    if(!allowParameterOverride() || filename===""){
        filename = DEFAULT_ROOT_ZIP_FILE;
    }else if(!filename.endsWith(".zip")){
        filename += ".zip";
    }
    console.log("setting " + param + " zip file to: "+filename);
    return filename;
}

function getZipFileList(param) {
    var zipFiles = [];
    var filenames = getParameter(param);
    if(!allowParameterOverride() || filenames===""){
        console.log("not setting " + param + " zip file(s)");
    }else{
        var zipFilenames = filenames.split(';');
        for(var i=0; i < zipFilenames.length; i++) {
            var filename = zipFilenames[i];
            if(!filename.endsWith(".zip")) filename += ".zip";
            zipFiles.push(filename);
        }
        console.log("setting " + param + " zip file(s) to: "+zipFiles);
    }
    return zipFiles;
}

// Memory optimization: fetch API to handle base64 decoding natively
function getBase64Data(base64Data) {
    return fetch("data:application/octet-stream;base64," + base64Data)
        .then(res => res.arrayBuffer())
        .then(buffer => new Uint8Array(buffer));
}

// Memory optimization: explicit garbage collection references
function loadFile(pathPrefix, filename, callback) {
    fetch(pathPrefix + filename, { method: 'GET' }).then(function(response) {
        if (response.status === 200) {
            response.arrayBuffer().then(function(buffer) {
                let arr = new Uint8Array(buffer);
                callback(arr);
                arr = null; 
                buffer = null; 
            });
        } else {
            console.log('Unable to load:' + filename + ' error:' + response.status);
        }
    });
}

function buildAppFileSystem(callback) {
    if(Config.appPayload.length > 0){
        getBase64Data(Config.appPayload).then(uint8Array => {
            createFile("/", Config.payloadZipFile, uint8Array);
            uint8Array = null;
            callback();
        });
    }else if(Config.appZipFile.length > 0){
        loadFile(Config.locateAppBaseUrl, Config.appZipFile, (uint8Array) => {
            if (Config.Program.length > 0) {            	
                let zipEntries = getZipEntries(uint8Array);
                let folder = Config.appZipFile.toLowerCase().endsWith('.zip') ?
                     Config.appZipFile.substring(0, Config.appZipFile.length - 4) : Config.appZipFile;
                let executablePathAndFilename = folder + "/" + Config.Program;
                let exeFileList = zipEntries.filter(e => !e.directory && e.filename === executablePathAndFilename);
                if (exeFileList.length === 1) {
                    Config.appSubfolder = folder;
                }
            }
            createFile("/", Config.appZipFile, uint8Array);
            uint8Array = null;
            callback();
        });
    }else{
        callback();
    }
}

function buildExtraFileSystems(callback) {
    let extraFSs = [];
    if(Config.extraPayload.length > 0){
        getBase64Data(Config.extraPayload).then(uint8Array => {
            createFile("/", "overlay.zip", uint8Array);
            uint8Array = null;
            callback();
        });
    }else if(Config.extraZipFiles.length > 0){
        for(let i = 0; i < Config.extraZipFiles.length; i++) {
            loadFile(Config.locateOverlayBaseUrl, Config.extraZipFiles[i], (uint8Array) => {
                createFile("/", Config.extraZipFiles[i], uint8Array);
                uint8Array = null;
                extraFSs.push(Config.extraZipFiles[i]);
                if(extraFSs.length === Config.extraZipFiles.length) {
                    callback();
                }
            });
        }
    }else{
        callback();
    }
}

function initBrowserFilesystem(callback) {
    console.log("Use Storage mode: "+Config.storageMode);
    FS.mkdir(ROOT);
    FS.mkdir(Config.d_drive);
    if (Config.storageMode === STORAGE_INDEXED_DB) {
        FS.mount(IDBFS, {autoPersist: true}, ROOT);
        if (Config.persist_d_drive) {
            FS.mount(IDBFS, {autoPersist: true}, Config.d_drive);
        }
        FS.syncfs(true, function (err) {
            if (err) {
                console.log('unable to sync folder: ' + ROOT);
            } else {
                callback();
            }
        });
    } else {
        callback();
    }
}

function buildBrowserFileSystem() {
    if(Config.showUploadDownload){
        document.getElementById('uploadbtn').style.display = "";
        document.getElementById('downloadbtn').style.display = "";
    }
    spinnerElement.style.display = 'none';
    var loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.hidden = true;
    toggleConsole();
    if(Config.isAutoRunSet){
        start();
    }else{
        var startBtn = document.getElementById('startbtn');
        startBtn.disabled = false;
        startBtn.style.display = "";
        var soundToggle = document.getElementById('soundToggle');
        if(Config.isSoundEnabled){
            soundToggle.checked = true;
        }
        document.getElementById('sound-checkbox').style.display = "";
    }
}

// Kept as an empty function because boxedwine.html explicitly calls it
function closeGetFilesModal() {}

function start() {
    if(isRunning) return;
    startEmulator();
}

function startEmulator() {
    isRunning = true;
    document.getElementById('startbtn').style.display = 'none';
    document.getElementById('sound-checkbox').style.display = 'none';

    var params = getEmulatorParams();
    for(var i=0; i < params.length; i++) {
        Module['arguments'].push(params[i]);
    }

    document.getElementById('startbtn').textContent = "Running...";
    Module["removeRunDependency"]("setupBoxedWine");
}

var initialSetup = function(){
    console.log("running initial setup");
    setConfiguration();
    if (Config.emEnvProps.length > 0) {
        Config.emEnvProps.forEach(function(prop){
            ENV[prop.key] = prop.value;
        });
    }
    Module["addRunDependency"]("setupBoxedWine");
    initBrowserFilesystem(() => {
        spinnerElement.style.display = '';
        spinnerElement.hidden = false;
    
        buildExtraFileSystems(() => {
            buildAppFileSystem(() => {
                loadFile(Config.locateRootBaseUrl, Config.rootZipFile, (rootZipfileBytes) => {
                    createFile("/", Config.rootZipFile, rootZipfileBytes);
                    rootZipfileBytes = null;
                    buildBrowserFileSystem();
                });
            });
        });
    });
}

function getEntriesAsPromise(item, exeFiles, allFiles, firstCall) {
    return new Promise((resolve, reject) => {
        if(firstCall && !Config.isAutoRunSet && !isRunning){
            loadExeModal(exeFiles, allFiles);
        }
        if(item.isDirectory){
            let reader = item.createReader();
            let doBatch = () => {
                reader.readEntries(entries => {
                    if (entries.length > 0) {
                        entries.forEach(function(entry){
                            getEntriesAsPromise(entry, exeFiles, allFiles, false);
                        });
                        doBatch();
                    } else {
                        resolve();
                    }
                }, reject);
            };
            doBatch();
        }else{
            let fullPath = item.fullPath;
            let uppercase = fullPath.toUpperCase();
            allFiles.push(fullPath);
            if(uppercase.endsWith(".EXE") || uppercase.endsWith(".BAT")){
                exeFiles.push(fullPath);
            }
            item.file(function(item){uploadFile(item, fullPath, allFiles);}, e => console.log(e));
        }
    });
}

function loadExeModal(exeFiles, allFiles) {
    document.getElementById('modalLinkExe').click();
    var message = document.getElementById('message');
    message.innerHTML = "<p>Uploading files...</p>";
    ExeFileTimer = setInterval(function(){readyCheck(exeFiles, allFiles);}, 100);
}

function populateModalExe(exeFiles) {
    var root = document.getElementById('items');
    root.innerHTML = '';
    let listElement = document.createElement("lu");
    for(let i = 0; i < exeFiles.length; i++) {
        let fullPath = exeFiles[i];
        let element = document.createElement("li");
        element.addEventListener("click", function(){execute(fullPath);}, false);
        element.innerHTML = fullPath;
        listElement.appendChild(element);
    }
    root.appendChild(listElement);
}

function execute(filename) {
    var root = document.getElementById('items');
    document.getElementById('openModalExeClick').click();
    var file = filename.substring(filename.lastIndexOf("/")+1, filename.length);
    var path = filename.substring(0, filename.lastIndexOf("/"));
    Config.WorkingDir = "/home/username/.wine/dosdevices/d:/" + path.substring(1);
    Config.Program = file;
    startEmulator();
}

function readyCheck(exeFiles, allFiles) {
    if(allFiles.length === 0){
        clearInterval(ExeFileTimer);
        var message = document.getElementById('message');
        message.innerHTML = exeFiles.length === 0 ? 'No executable files found' : '';
        populateModalExe(exeFiles);
    }
}

dropzone.addEventListener("dragover", event => event.preventDefault(), false);
dropzone.addEventListener("drop", function(event){
    event.preventDefault();
    let items = event.dataTransfer.items;
    let exeFiles = [];
    let allFiles = [];
    for(let i =0; i < items.length; i++){
        getEntriesAsPromise(items[i].webkitGetAsEntry(), exeFiles, allFiles, true);
    }
}, false);

function getEmulatorParams() {        
    let params = ["-root", ROOT];
    params.push("-zip");
    params.push(Config.rootZipFile);
    
    if(Config.extraZipFiles.length > 0){
        for(let i = 0; i < Config.extraZipFiles.length; i++) {
            params.push("-zip");
            params.push(Config.extraZipFiles[i]);
        }
    }    		
    if(Config.extraPayload.length > 0){
        params.push("-zip");
        params.push("overlay.zip");
    }
    
    if (Config.appZipFile.length > 0) {
        params.push("-mount");
        params.push(Config.appZipFile);
        params.push(Config.appDirPrefix);          
    } else if (Config.appPayload.length > 0){
        params.push("-mount");
        params.push(Config.payloadZipFile);
        params.push(Config.appDirPrefix);          			
    }
                
    params.push("-mount_drive");
    params.push(Config.d_drive);
    params.push("d");
    
    if (Config.resolution != null) {
        params.push("-resolution");
        params.push(Config.resolution);
    }
    if (Config.ddrawOverridePath != null) {
        params.push("-ddrawOverride");
        params.push(Config.ddrawOverridePath);
    }
    if (Config.frameSkip != "0") {
        params.push("-skipFrameFPS");
        params.push(Config.frameSkip);
    }            
    
    if(!Config.isSoundEnabled) params.push("-nosound");
    if (Config.disableHideCursor) params.push("-disableHideCursor");
    if(Config.bpp != DEFAULT_BPP){
        params.push("-bpp");
        params.push("" + Config.bpp);
    }
    if(Config.cpu.length > 0){
        params.push("-" + Config.cpu);
    }
    if(Config.envProp.length > 0){
        params.push("-env");
        params.push(Config.envProp);
    }

    if (!Config.loadDesktop) {
        if(Config.WorkingDir.length > 0){
            params.push("-w");
            params.push(Config.WorkingDir);
        }else if(Config.appPayload.length > 0 && Config.Program.length > 0 && Config.Program.substring(0 ,1) != "/"){
            params.push("-w");
            params.push(Config.appDirPrefix);
        }else if(Config.appZipFile.length > 0 && Config.Program.length > 0 && Config.Program.substring(0 ,1) != "/"){
            params.push("-w");
            params.push(Config.appSubfolder.length > 0 ? Config.appDirPrefix + "/" + Config.appSubfolder : Config.appDirPrefix);
        }
    }
    params.push("/bin/wine");
    if(Config.Program.length > 0 && !Config.loadDesktop){
        // The desktop must be exactly the canvas/game size, otherwise the game's
        // window sits in a larger black desktop and only fills part of the screen.
        params.push("explorer");
        params.push("/desktop=game," + DISPLAY_WIDTH + "x" + DISPLAY_HEIGHT);
        if (Config.Program.endsWith('.bat')) {
            params.push("cmd");
            params.push("/c");
        }
        params.push(Config.Program);
    }else{
        params.push("explorer");
        params.push("/desktop=shell");
    }
    console.log("Emulator params:" + params);
    return params;
}

var Module = {
    preRun: [initialSetup],
    arguments: [],
    postRun: [],
    print: (function() {
        var element = document.getElementById('output');
        if (element) element.value = '';
        return function(text) {
            text = Array.prototype.slice.call(arguments).join(' ');
            // With DevTools open this is not free - Wine prints hundreds of fixme
            // lines, and a busy console costs real frames. Enable with ?debug=true.
            if (DEBUG_LOG) console.log(text);
            // Don't touch the DOM for the hidden console: Wine spams the log and the
            // textarea reflow costs frames while the game is running.
            if (element && element.style.display !== 'none') {
                element.value += text + "\n";
                if (element.value.length > 100000) element.value = element.value.slice(-50000);
                element.scrollTop = element.scrollHeight;
            }
        };
    })(),
    printErr: function(text) {
        text = Array.prototype.slice.call(arguments).join(' ');
        if (DEBUG_LOG) console.error(text);
    },
    canvas: (function() {
        var canvas = document.getElementById('canvas');
        canvas.addEventListener("webglcontextlost", function(e) { alert('WebGL context lost. You will need to reload the page.'); e.preventDefault(); }, false);
        canvas.width  = DISPLAY_WIDTH;
        canvas.height = DISPLAY_HEIGHT;
        return canvas;
    })(),
    setStatus: function(text) {
        if (!Module.setStatus.last) Module.setStatus.last = { time: Date.now(), text: '' };
        if (text === Module.setStatus.text) return;
        var m = text.match(/([^(]+)\((\d+(\.\d+)?)\/(\d+)\)/);
        var now = Date.now();
        if (m && now - Date.now() < 30) return; 
        if (m) {
            text = m[1];
            progressElement.value = parseInt(m[2])*100;
            progressElement.max = parseInt(m[4])*100;
            progressElement.hidden = false;
            spinnerElement.hidden = false;
        } else {
            progressElement.value = null;
            progressElement.max = null;
            progressElement.hidden = true;
            if (!text) spinnerElement.hidden = true;
        }
        statusElement.innerHTML = text;
    },
    totalDependencies: 0,
    monitorRunDependencies: function(left) {
        this.totalDependencies = Math.max(this.totalDependencies, left);
        Module.setStatus(left ? 'Preparing... (' + (this.totalDependencies-left) + '/' + this.totalDependencies + ')' : '');
    }
};

Module.setStatus('Downloading...');
window.onerror = function() {
    Module.setStatus('Exception thrown, see JavaScript console');
    spinnerElement.style.display = 'none';
    Module.setStatus = function(text) {
        if (text) Module.printErr('[post-exception status] ' + text);
    };
};

function startWithFiles(files) {
    for (let i = 0; i < files.length; i++) uploadFile(files[i]);
}

function uploadFile(file, fullPath, allFiles) {
    let filename = fullPath ? (fullPath.startsWith("/") ? fullPath.substring(1) : fullPath) : (file.webkitRelativePath.length === 0 ? file.name : file.webkitRelativePath);
    var filereader = new FileReader();
    filereader.file_name = file.name;
    filereader.onload = function(){readFile(this.result, filename, allFiles)};
    filereader.readAsArrayBuffer(file);
}

function readFile(data, name, allFiles) {
    let filename = name.substring(name.lastIndexOf("/")+1,name.length);
    if(name.toLowerCase().endsWith('zip')){
        createFile(Config.d_drive, filename, new Uint8Array(data));
    }else{
        var done = false;
        var startIndex = 0;
        var base = Config.d_drive + "/";
        while(!done){
            var dirIndex = name.indexOf("/", startIndex);
            if(dirIndex === -1){
                done = true;
            }else{
                var dirName = name.substring(startIndex, dirIndex);
                if(dirName.length > 0) {
                    createFolder(base, dirName);
                    base = base + dirName + "/";
                }
                startIndex = dirIndex + 1;
            }
        }
        createFile(base.substring(0,base.length-1), filename, new Uint8Array(data));
    }
    if(allFiles) allFiles.pop();
}

function createFolder(parent, dir) {
    try {
        FS.createPath(parent, dir, true, true);
        console.log("Directory created :" + parent +  dir);
    } catch(ef) {
        console.log("Unable to create folder:" + parent + dir + " error:" + ef);
    }
}

function createFile(dir, name, buf) {
    try {
        FS.createDataFile(dir, name, buf, true, true);
        console.log("File created:" + dir + "/" + name);
    } catch(e) {
        console.log("Unable to create file:" + dir + "/" + name + "  error:" + e);
    }
}

function toggleConsole() {
    var el = document.getElementById('showConsole');
    var consoleEl = document.getElementById('output');
    if (!consoleEl) return;
    consoleEl.style.display = (el && el.checked) ? 'block' : 'none';
}

function toggleSound() {
    Config.isSoundEnabled = document.getElementById('soundToggle').checked;
}

function toggleDirectory(item) {
    var itemWidget = document.getElementById(item);
    if(itemWidget != null){
        if(itemWidget.style.display === 'none'){
            itemWidget.style.display = "";
            document.getElementById(item+'-expand').style.display = "none";
            document.getElementById(item+'-contract').style.display = "";
        }else{
            itemWidget.style.display = "none";
            document.getElementById(item+'-expand').style.display = "";
            document.getElementById(item+'-contract').style.display = "none";
        }
    }
}

function getParameter(inputKey) {
    var retVal = "";
    var replacementParameters = Config.urlParams;
    var url = replacementParameters.length > 0 ? "?" + replacementParameters : window.location.href;
    var index = url.indexOf("?")+1;
    if(index > 0){
        var paramStr = url.substring(index);
        var params = paramStr.split("&");
        for(var x=0;x<params.length;x++){
            var param = params[x];
            var kv = param.split("=");
            if(kv[0] === inputKey){
                retVal = kv[1];
                break;
            }
        }
    }
    var hashIndex = retVal.lastIndexOf('#');
    if(hashIndex > 0) retVal = retVal.substring(0, hashIndex);
    return retVal;
}

var index = 0;
var files = [];
var selectedItem;
var selectedFilename;

function select(idx, dir, filename) {
    if(selectedItem != null) selectedItem.style.backgroundColor = "";
    selectedItem = document.getElementById(idx + '-data');
    selectedItem.style.backgroundColor = "#94c2c5";
    document.getElementById('selectedItem').value = filename != null ? dir + filename : dir;
    selectedFilename = filename;
}

function endsWith(str, suffix) {
    return str.indexOf(suffix, str.length - suffix.length) !== -1;
}

function extract() {
    let file = document.getElementById('selectedItem').value;
    if(file != null && file.length > 0 && files.length > 1) {
        if(endsWith(file,"/")) return;
        let data = FS.readFile(file, { encoding: 'binary' });
        let blob =  new Blob([data], {type: "octet/stream"});
        
        let link = document.createElement('a');
        link.setAttribute('download', selectedFilename);
        link.setAttribute('href', window.URL.createObjectURL(blob));
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

function leaf(entry) {
    index++;
    return "<tr><td><span id=\"" + index + "-data\" onclick=\"select(" + index + ",'" + entry.dir + "','" + entry.filename + "')\">" + entry.filename + "</span></td></tr>";
}

// Memory Optimization: Replaced string concatenation with array join 
function branch(entries) {
    var item = entries[index];
    index++;
    var dir = item.dir;
    var dirName = dir.substring(0, dir.length - 1);
    dirName = dirName.substring(dirName.lastIndexOf("/")+1,dirName.length);
    
    var htmlParts = [];
    htmlParts.push("<tr><td>");
    htmlParts.push("<span id=\"" + index + "-expand\"><a onclick=\"toggleDirectory('" + index + "')\"><strong>+</strong></a></span>");
    htmlParts.push("<span id=\"" + index + "-contract\" style=\"display:none;\"><a onclick=\"toggleDirectory('" + index + "')\"><strong>-</strong></a></span>");
    htmlParts.push("<span id=\"" + index + "-data\" onclick=\"select(" + index + ",'" + dir + "', null)\">[" + dirName + "]</span>");
    htmlParts.push("<div id='" + index + "' style=\"display:none;\"><table>");
    
    while(index < entries.length){
        var nextItem = entries[index];
        if(nextItem.dir === item.dir){
            htmlParts.push(leaf(nextItem));
        }else if(parentDir(nextItem.dir) === item.dir){
            htmlParts.push(branch(entries));
        }else{
            break;
        }
    }
    htmlParts.push("</table></div></td></tr>");
    return htmlParts.join('');
}

function parentDir(childDir) {
    if(endsWith(childDir,"/")) childDir = childDir.substring(0,childDir.length - 1);
    return childDir.substring(0, childDir.lastIndexOf('/') + 1);
}

function buildGetFilesModal() {
    buildGetFilesModalForFolder(Config.d_drive);
}

function buildGetFilesModalForFolder(folder) {
    document.getElementById('modalLink').click();
    let root = document.getElementById('tree');
    document.getElementById('selectedItem').value = "";
    selectedFilename = null;
    files = [];
    root.innerHTML = "";
    index = 0;
    readFiles(folder + "/", files);

    let contents = "<table>" + branch(files) + "</table>";
    document.getElementById('loadStatus').style.display="none";
    root.innerHTML = contents;
    toggleDirectory('1');
}

function readFiles(currentDir, files) {
    console.log("adding directory: " + currentDir);
    files.push({dir : currentDir, filename : ""});
    var entries = FS.readdir(currentDir).filter(param => param !== "." && param !== "..");
    entries.forEach(function(entry) {
        var fileEntry = FS.lookupPath(currentDir + entry, { follow: true });
        if (fileEntry.node.isFolder) {
            readFiles(currentDir + entry + "/", files);
        }else{
            console.log("adding file: " + currentDir + entry);
            files.push({dir : currentDir, filename : entry});
        }
    });
}

/** code from https://github.com/Rob--W/zipinfo.js MIT license **/
// Memory Optimization: Hoisted decoders outside of the parsing loop
function getZipEntries(data) {
    var view = new DataView(data.buffer, data.byteOffset, data.length);
    var entriesLeft = 0;
    var offset = 0;
    var endoffset = data.length;
    
    for (var i = data.length - 22, ii = Math.max(0, i - 0xFFFF); i >= ii; --i) {
        if (data[i] === 0x50 && data[i + 1] === 0x4b && data[i + 2] === 0x05 && data[i + 3] === 0x06) {
            endoffset = i;
            offset = view.getUint32(i + 16, true);
            entriesLeft = view.getUint16(i + 8, true);
            break;
        }
    }
    var entries = [{
        directory: true,
        filename: '/',
        uncompressedSize: 0,
        centralDirectoryStart: offset,
    }];
    if (offset >= data.length || offset <= 0) {
        offset = -1;
        entriesLeft = 0xFFFF;
        while (++offset < data.length && data[offset] !== 0x50 && data[offset + 1] !== 0x4b && data[offset + 2] !== 0x01 && data[offset + 3] !== 0x02);
    }
    
    endoffset -= 46; 

    // Hoisted Decoders
    const decoderAscii = new TextDecoder('ascii');
    const decoderUtf8 = new TextDecoder('utf-8');

    while (--entriesLeft >= 0 && offset < endoffset) {
        if (view.getUint32(offset) != 0x504b0102) break;
        
        var bitFlag = view.getUint16(offset + 8, true);
        var uncompressedSize = view.getUint32(offset + 24, true);
        var fileNameLength = view.getUint16(offset + 28, true);
        var extraFieldLength = view.getUint16(offset + 30, true);
        var fileCommentLength = view.getUint16(offset + 32, true);
        var filenameBytes = data.subarray(offset + 46, offset + 46 + fileNameLength);
        
        var filename = (bitFlag & 0x800) ? decoderUtf8.decode(filenameBytes) : decoderAscii.decode(filenameBytes);
        
        entries.push({
            directory: filename.endsWith('/'),
            filename: filename,
            uncompressedSize: uncompressedSize,
        });
        offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
    }
    return entries;
};
// Keep the canvas exactly the size of the visible game, centred in the viewport.
installCanvasFit();
installDisplayHandlers();
window.addEventListener("load", fitCanvasToViewport);
