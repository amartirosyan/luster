(function () {
  var bridges = [];
  var APP = "com.lustre.tv";
  var REGISTER = "luna://com.webos.service.tvpower/power/registerScreenSaverRequest";
  var RESPONSE = "luna://com.webos.service.tvpower/power/responseScreenSaverRequest";
  var registered = {};

  function constructors() {
    var list = [];
    if (typeof PalmServiceBridge !== "undefined") list.push(PalmServiceBridge);
    if (typeof WebOSServiceBridge !== "undefined" && WebOSServiceBridge !== PalmServiceBridge) {
      list.push(WebOSServiceBridge);
    }
    return list;
  }

  function send(Ctor, uri, params, onResponse) {
    var bridge = new Ctor();
    bridges.push(bridge);
    var handle = function (message) {
      if (!onResponse) return;
      var response = message;
      if (typeof message === "string") {
        try {
          response = JSON.parse(message);
        } catch (err) {
          return;
        }
      }
      if (!response || typeof response !== "object") return;
      onResponse(response);
    };
    bridge.onservicecallback = handle;
    bridge.onload = handle;
    bridge.call(uri, JSON.stringify(params));
    return bridge;
  }

  function veto(Ctor, name, timestamp) {
    var visible = document.visibilityState !== "hidden";
    send(Ctor, RESPONSE, {
      clientName: name,
      timestamp: timestamp,
      ack: !visible,
    });
    if (visible) window.dispatchEvent(new CustomEvent("lustre-saver-request"));
  }

  function register(Ctor, name) {
    var key = name + ":" + (Ctor.name || "bridge");
    if (registered[key]) return;
    registered[key] = true;
    send(Ctor, REGISTER, { clientName: name, subscribe: true }, function (response) {
      if (response.returnValue === false && String(response.errorCode) === "-3") {
        registered[key] = false;
        if (name.indexOf(".") === -1 || name === APP) register(Ctor, APP + "." + Date.now());
        return;
      }
      if (response.timestamp == null) return;
      veto(Ctor, name, response.timestamp);
    });
  }

  function startBridge() {
    var ctors = constructors();
    if (!ctors.length) return false;
    ctors.forEach(function (Ctor) {
      register(Ctor, APP);
    });
    return true;
  }

  function keepVideo() {
    var video = document.getElementById("lustre-keep");
    if (!video) {
      video = document.createElement("video");
      video.id = "lustre-keep";
      video.muted = true;
      video.defaultMuted = true;
      video.loop = true;
      video.autoplay = true;
      video.playsInline = true;
      video.setAttribute("muted", "");
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.src = "media/keep.mp4";
      video.style.cssText = "position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;pointer-events:none;opacity:0.02";
      document.body.insertBefore(video, document.body.firstChild);
      video.addEventListener("pause", function () {
        if (document.visibilityState !== "hidden") video.play().catch(function () {});
      });
      video.addEventListener("ended", function () {
        video.play().catch(function () {});
      });
    }
    var play = video.play();
    if (play && play.catch) play.catch(function () {});
  }

  function start() {
    startBridge();
    keepVideo();
  }

  start();
  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    start();
    if (tries > 30) clearInterval(timer);
  }, 1000);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "hidden") keepVideo();
  });
  window.addEventListener("keydown", keepVideo, true);
  window.addEventListener("pointerdown", keepVideo, true);
  window.lustreStayAwake = start;
})();
