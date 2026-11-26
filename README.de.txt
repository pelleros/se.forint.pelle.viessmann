Hol deine Viessmann-Heizung in Homey. Ob Wärmepumpe, Gasheizung oder Brennstoffzelle: Du siehst Temperaturen, die Betriebsart und ob Verdichter oder Brenner laufen (mit Betriebsstunden und Starts), änderst Einstellungen für Heizung und Warmwasser und überlässt den Rest deinen Flows.

Viessmann verlangt, dass jeder Nutzer eine eigene, kostenlose Client ID anlegt. Die Einrichtung dauert etwa fünf Minuten:
1. Installiere die App und öffne ihre Einstellungen in Homey. Dort findest du einen Link zum Viessmann-Entwicklerportal und die Redirect URI zum Kopieren.
2. Melde dich im Entwicklerportal mit deinem ViCare-Konto an und lege einen neuen Client an. Nenne ihn Homey, schalte Google reCAPTCHA aus und füge die Redirect URI genau so ein, wie sie angezeigt wird. Viessmann erlaubt nur einen Client pro Konto: Hast du schon einen (zum Beispiel für Home Assistant), nimm diesen und füge ihm die Redirect URI hinzu.
3. Kopiere die Client ID in die App-Einstellungen und speichere sie.
4. Füge ein neues Gerät hinzu, wähle Viessmann ViCare und melde dich mit deinem ViCare-Konto an.

Falls etwas nicht klappt:
- „Invalid redirection URI“ bei der Anmeldung: Die Redirect URI in deinem Viessmann-Client stimmt nicht. Füge sie erneut aus den App-Einstellungen ein.
- Die Anmeldung klappt, aber es werden keine Geräte gefunden: Prüfe, ob deine Heizung in der ViCare-App erscheint und ob die Client ID gespeichert war, bevor du das Gerät hinzugefügt hast.
- Gerät nach einiger Zeit nicht verfügbar: Öffne die Geräteeinstellungen, wähle Reparieren und melde dich erneut an.
Weitere Tipps findest du in den App-Einstellungen, und Hilfe gibt es im Homey Community Forum.
