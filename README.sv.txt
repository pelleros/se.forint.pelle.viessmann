Koppla din Viessmann-värme till Homey. Oavsett om du har värmepump, gaspanna eller bränslecell kan du följa temperaturer, driftläge och om kompressorn eller brännaren går (med drifttimmar och antal starter), ändra inställningar för värme och varmvatten och låta dina Flows sköta resten.

Viessmann kräver att varje användare skapar ett eget, kostnadsfritt Client ID, så det tar ungefär fem minuter att komma igång:
1. Installera appen och öppna dess inställningar i Homey. Där finns en länk till Viessmanns utvecklarportal och redirect URI:n, klar att kopiera.
2. Logga in på utvecklarportalen med ditt ViCare-konto och lägg till en ny klient. Döp den till Homey, stäng av Google reCAPTCHA och klistra in redirect URI:n exakt som den visas. Viessmann tillåter bara en klient per konto: har du redan en (till exempel för Home Assistant), använd den och lägg till redirect URI:n i den.
3. Kopiera Client ID:t till appens inställningar och spara.
4. Lägg till en ny enhet, välj Viessmann ViCare och logga in med ditt ViCare-konto.

Om något inte fungerar:
- "Invalid redirection URI" vid inloggningen: redirect URI:n i din Viessmann-klient stämmer inte. Klistra in den igen från appens inställningar.
- Inloggningen fungerar men inga enheter hittas: kontrollera att din värmeanläggning syns i ViCare-appen och att Client ID:t var sparat innan du lade till enheten.
- Enheten är otillgänglig efter en tid: öppna enhetens inställningar, välj Reparera och logga in igen.
Fler tips finns i appens inställningar, och hjälp får du på Homey Community Forum.
