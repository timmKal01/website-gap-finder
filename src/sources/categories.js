// The search's 32 business types (the input dropdown), mapped to Overture Maps place categories. A place matches a
// type when its basic_category, its taxonomy.primary or any level of its taxonomy.hierarchy is in the type's list.
// Titles are Gap Finder's own; the Overture names are copied from local-business-leads (checked against the
// 2026-10-21.0 release). Evolve independently.

export const CATEGORIES = {
    plumber: { title: 'Plumbers', overture: ['plumbing'] },
    electrician: { title: 'Electricians', overture: ['electrician'] },
    hvac: { title: 'Heating and air conditioning (HVAC)', overture: ['hvac_service'] },
    roofer: { title: 'Roofers', overture: ['roofing'] },
    carpenter: { title: 'Carpenters and joiners', overture: ['carpenter'] },
    painter: { title: 'Painters and decorators', overture: ['painting'] },
    hair: { title: 'Hair salons and barbers', overture: ['hair_salon', 'barber', 'hair_stylist'] },
    beauty: { title: 'Beauty and nail salons', overture: ['beauty_salon', 'nail_salon', 'skin_care_and_makeup', 'eyelash_service', 'waxing'] },
    massage: { title: 'Massage and spas', overture: ['massage_therapy', 'spa', 'day_spa'] },
    tattoo: { title: 'Tattoo and piercing studios', overture: ['tattoo_and_piercing', 'tattoo'] },
    dentist: { title: 'Dentists', overture: ['dental_clinic'] },
    doctor: { title: 'Doctors and clinics', overture: ['doctors_office', 'family_practice', 'primary_care_or_general_clinic', 'walk_in_clinic', 'urgent_care_clinic', 'pediatric_clinic'] },
    physio: { title: 'Physiotherapists', overture: ['physical_therapy'] },
    vet: { title: 'Veterinarians', overture: ['veterinarian'] },
    optician: { title: 'Opticians', overture: ['vision_or_eye_care_clinic', 'eyewear_store'] },
    gym: { title: 'Gyms and fitness studios', overture: ['gym', 'fitness_studio', 'fitness_trainer'] },
    restaurant: { title: 'Restaurants', overture: ['restaurant'] },
    cafe: { title: 'Cafes', overture: ['coffee_shop', 'cafe'] },
    bakery: { title: 'Bakeries', overture: ['bakery'] },
    hotel: { title: 'Hotels and guest houses', overture: ['hotel', 'bed_and_breakfast', 'inn'] },
    car_repair: { title: 'Car repair garages', overture: ['automotive_repair'] },
    car_dealer: { title: 'Car dealers', overture: ['auto_dealer'] },
    lawyer: { title: 'Lawyers', overture: ['attorney_or_law_firm'] },
    accountant: { title: 'Accountants', overture: ['accountant'] },
    estate_agent: { title: 'Real estate agents', overture: ['real_estate_agent'] },
    florist: { title: 'Florists', overture: ['florist', 'flowers_and_gifts_store'] },
    clothes: { title: 'Clothing stores', overture: ['clothing_store', 'womens_clothing_store', 'mens_clothing_store', 'childrens_clothing_store', 'fashion_boutique'] },
    furniture: { title: 'Furniture stores', overture: ['furniture_store'] },
    photographer: { title: 'Photographers', overture: ['photography_service', 'event_photography_service', 'session_photography_service'] },
    driving_school: { title: 'Driving schools', overture: ['driving_school'] },
    childcare: { title: 'Nurseries and childcare', overture: ['child_care_and_day_care', 'day_care_preschool', 'preschool'] },
    laundry: { title: 'Laundry and dry cleaning', overture: ['laundry_service', 'laundromat', 'dry_cleaning'] },
};

/** A test for one business type, applied to a place's basic_category and taxonomy. */
export function categoryMatcher(categoryKey) {
    const wanted = new Set(CATEGORIES[categoryKey].overture);
    return (place) => wanted.has(place.basic_category)
        || wanted.has(place.taxonomy?.primary)
        || (place.taxonomy?.hierarchy ?? []).some((level) => wanted.has(level));
}

/** "general_dentistry" -> "General dentistry". */
export const categoryLabel = (name) => (name ? name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' ') : null);
