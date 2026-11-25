Koppel je Viessmann-verwarming aan Homey. Of je nu een warmtepomp, een cv-ketel of een brandstofcel hebt: je ziet temperaturen, bedrijfsstatus en energieverbruik, past instellingen voor verwarming en warm water aan en laat de rest over aan je Flows.

Viessmann vraagt elke gebruiker om een eigen, gratis Client ID aan te maken. Het instellen duurt ongeveer vijf minuten:
1. Installeer de app en open de app-instellingen in Homey. Daar vind je een link naar het Viessmann-ontwikkelaarsportaal en de redirect URI, klaar om te kopiëren.
2. Log in op het ontwikkelaarsportaal met je ViCare-account en voeg een nieuwe client toe. Noem hem Homey, zet Google reCAPTCHA uit en plak de redirect URI precies zoals hij wordt getoond.
3. Kopieer de nieuwe Client ID naar de app-instellingen en sla hem op.
4. Voeg een nieuw apparaat toe, kies Viessmann ViCare en log in met je ViCare-account.

Lukt het niet?
- "Invalid redirection URI" bij het inloggen: de redirect URI in je Viessmann-client klopt niet. Plak hem opnieuw vanuit de app-instellingen.
- Inloggen lukt, maar er worden geen apparaten gevonden: controleer of je verwarming in de ViCare-app staat en of de Client ID was opgeslagen voordat je het apparaat toevoegde.
- Apparaat na een tijdje niet beschikbaar: open de apparaatinstellingen, kies Repareren en log opnieuw in.
Meer tips staan in de app-instellingen, en hulp vind je op het Homey Community Forum.
