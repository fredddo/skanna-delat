// Körs bara i webbläsare utan ES-moduler (nomodule): visa ett begripligt fel i stället för en tom sida.
(function () {
  var l = document.getElementById("laddar");
  if (l) l.hidden = true;
  var f = document.getElementById("fel");
  var t = document.getElementById("felText");
  if (t) t.textContent = "Webbläsaren är för gammal för visaren. Öppna länken i en aktuell Safari, Chrome, Firefox eller Edge.";
  if (f) f.hidden = false;
})();
