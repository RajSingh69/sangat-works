const mapElement = document.getElementById("map");

if (mapElement) {
  const map = L.map("map").setView([54.5, -3.2], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  const demoLocations = [
    {
      name: "Demo Sikh Electrician",
      service: "Electrician",
      town: "Woking",
      lat: 51.319,
      lng: -0.558,
      tags: ["electrician", "rewiring", "emergency"]
    },
    {
      name: "Demo Sikh Accountant",
      service: "Accountant",
      town: "Birmingham",
      lat: 52.4862,
      lng: -1.8904,
      tags: ["accountant", "tax", "business"]
    },
    {
      name: "Demo Sikh Web Developer",
      service: "Web Developer",
      town: "London",
      lat: 51.5072,
      lng: -0.1276,
      tags: ["web developer", "software", "firebase"]
    }
  ];

  demoLocations.forEach(profile => {
    L.marker([profile.lat, profile.lng])
      .addTo(map)
      .bindPopup(`
        <strong>${profile.name}</strong><br>
        ${profile.service}<br>
        ${profile.town}<br>
        <a href="view.html">View profile</a>
      `);
  });
}