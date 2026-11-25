Intégrez votre chauffage Viessmann à Homey. Que vous ayez une pompe à chaleur, une chaudière à gaz ou une pile à combustible, vous pouvez suivre les températures, le mode de fonctionnement et savoir si le compresseur ou le brûleur tourne (avec heures de fonctionnement et nombre de démarrages), modifier les réglages du chauffage et de l'eau chaude, et laisser vos Flows faire le reste.

Viessmann demande à chaque utilisateur de créer son propre Client ID gratuit. La mise en route prend donc environ cinq minutes :
1. Installez l'app et ouvrez ses paramètres dans Homey. Vous y trouverez un lien vers le portail développeur de Viessmann et l'URI de redirection (Redirect URI), prête à être copiée.
2. Connectez-vous au portail développeur avec votre compte ViCare et ajoutez un nouveau client. Nommez-le Homey, désactivez Google reCAPTCHA et collez l'URI de redirection exactement telle qu'elle est affichée.
3. Copiez le nouveau Client ID dans les paramètres de l'app et enregistrez-le.
4. Ajoutez un nouvel appareil, choisissez Viessmann ViCare et connectez-vous avec votre compte ViCare.

En cas de problème :
- « Invalid redirection URI » lors de la connexion : l'URI de redirection de votre client Viessmann ne correspond pas. Collez-la à nouveau depuis les paramètres de l'app.
- La connexion fonctionne, mais aucun appareil n'est trouvé : vérifiez que votre chauffage apparaît dans l'app ViCare et que le Client ID était enregistré avant l'ajout de l'appareil.
- Appareil indisponible au bout d'un certain temps : ouvrez les paramètres de l'appareil, choisissez Réparer et reconnectez-vous.
Vous trouverez d'autres conseils dans les paramètres de l'app, et de l'aide sur le Homey Community Forum.
