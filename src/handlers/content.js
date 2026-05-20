'use strict';

const res = require('../utils/response');

const AMENITIES = [
  { id: 'meals',       name: 'Home-Cooked Meals',  description: 'Fresh, local meals prepared with love every day.',                  icon: '🍽️' },
  { id: 'wifi',        name: 'Free Wi-Fi',          description: 'High-speed internet throughout the property.',                      icon: '📶' },
  { id: 'hot-water',   name: 'Hot Water',           description: '24/7 hot water supply in all rooms.',                              icon: '🚿' },
  { id: 'garden',      name: 'Garden & Terrace',    description: 'Lush garden and terrace with panoramic views.',                    icon: '🌿' },
  { id: 'parking',     name: 'Free Parking',        description: 'Ample secured parking for guests.',                                icon: '🅿️' },
  { id: 'laundry',     name: 'Laundry Service',     description: 'Same-day laundry available on request.',                          icon: '🧺' },
  { id: 'tours',       name: 'Local Tours',         description: 'Guided tours to nearby attractions arranged by us.',               icon: '🗺️' },
  { id: 'evening-tea', name: 'Evening Tea',         description: 'Complimentary evening tea & snacks daily.',                       icon: '☕' },
];

const CONTACT = {
  phone:    '+91 8542073022',
  whatsapp: '+918542073022',
  email:    'hello@gautamhomestay.com',
  location: {
    address: 'Village and Post - Bhaithauli, Ayar Bazzar',
    city:    'Varanasi',
    state:   'Uttar Pradesh',
    country: 'India',
    full:    'Village and Post - Bhaithauli, Ayar Bazzar, Varanasi, Uttar Pradesh, India',
  },
};

// GET /amenities  (public)
exports.listAmenities = async () => {
  return res.ok({ amenities: AMENITIES, count: AMENITIES.length });
};

// GET /contact  (public)
exports.getContact = async () => {
  return res.ok(CONTACT);
};
