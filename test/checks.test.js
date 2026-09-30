import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import {
    visibleText, isMobileFriendly, seoFacts, lastCopyrightYear, wordpressVersion, isPlaceholderPage,
    brokenPageReason, pageUrls, bookingInfo, socialLinks, contactPageUrl, isAppointmentBusiness,
} from '../src/audit/checks.js';

const NOW = new Date('2026-09-30T00:00:00Z');
const page = (body, head = '') => cheerio.load(`<html><head>${head}</head><body>${body}</body></html>`);

test('copyright year: English, ranges, year before the symbol, and other languages', () => {
    assert.equal(lastCopyrightYear(page('<footer>© 2019 Joe\'s Plumbing. All rights reserved.</footer>'), NOW), 2019);
    assert.equal(lastCopyrightYear(page('<footer>Copyright 2015-2021 Salon X</footer>'), NOW), 2021);
    assert.equal(lastCopyrightYear(page('<footer>2017 © Clínica Dental Sol</footer>'), NOW), 2017);
    assert.equal(lastCopyrightYear(page('<footer>© 2018 Todos los derechos reservados</footer>'), NOW), 2018);
    assert.equal(lastCopyrightYear(page('<div class="site-footer">(c) 2020 Friseur Müller</div>'), NOW), 2020);
    assert.equal(lastCopyrightYear(page('<footer>© Joe\'s Plumbing 2016</footer>'), NOW), 2016);
});

test('copyright year: none when written by JavaScript, future years ignored', () => {
    assert.equal(lastCopyrightYear(page('<footer>© <script>document.write(new Date().getFullYear())</script> Salon</footer>'), NOW), null);
    assert.equal(lastCopyrightYear(page('<footer>© 2031 Typo Ltd</footer>'), NOW), null);
});

test('mobile friendly needs a device-width viewport', () => {
    assert.equal(isMobileFriendly(page('', '<meta name="viewport" content="width=device-width, initial-scale=1">')), true);
    assert.equal(isMobileFriendly(page('', '<meta name="Viewport" content="width=1024">')), false);
    assert.equal(isMobileFriendly(page('')), false);
});

test('title and meta description', () => {
    assert.deepEqual(seoFacts(page('', '<title> </title>')), { missingTitle: true, missingMetaDescription: true, title: null });
    assert.equal(seoFacts(page('', '<title>Salon</title><meta name="description" content="Hair">')).missingMetaDescription, false);
});

test('WordPress version from generator or core asset URLs', () => {
    assert.equal(wordpressVersion('WordPress 5.8.2', ''), '5.8.2');
    assert.equal(wordpressVersion('', '<script src="/wp-includes/js/wp-emoji-release.min.js?ver=4.9.26"></script>'), '4.9.26');
    assert.equal(wordpressVersion('', '<p>no wp</p>'), null);
});

test('placeholder, parked, suspended and server default pages', () => {
    const soon = page('<h1>Coming Soon</h1>', '<title>Salon</title>');
    assert.equal(isPlaceholderPage(soon, visibleText(soon)), true);
    const parked = page('<p>This domain is for sale!</p>', '<title>joesplumbing.com</title>');
    assert.equal(brokenPageReason(parked, parked.html(), visibleText(parked)), 'Domain parked or for sale');
    const suspended = page('<p>This Account has been suspended.</p>', '<title>Account Suspended</title>');
    assert.equal(brokenPageReason(suspended, suspended.html(), visibleText(suspended)), 'Hosting account suspended');
    const nginx = page('<h1>Welcome to nginx!</h1>', '<title>Welcome to nginx!</title>');
    assert.equal(brokenPageReason(nginx, nginx.html(), visibleText(nginx)), 'Server default page, no site installed');
    const real = page('<h1>Joe\'s Plumbing</h1><p>Emergency plumber in Manchester since 1998.</p>', '<title>Joe\'s Plumbing</title>');
    assert.equal(brokenPageReason(real, real.html(), visibleText(real)), null);
});

test('booking: known provider link or widget, generic "book" labels in several languages', () => {
    const base = 'https://salon.example/';
    const fresha = page('<a href="https://www.fresha.com/a/salon-x-nairobi-abc123">Book</a>');
    assert.deepEqual(bookingInfo(fresha, pageUrls(fresha, base), base), { hasBooking: true, bookingProvider: 'Fresha' });
    const calendly = page('<script>Calendly.initInlineWidget({ url: "https://calendly.com/dr-x/checkup" })</script>');
    assert.equal(bookingInfo(calendly, pageUrls(calendly, base), base).bookingProvider, 'Calendly');
    const spanish = page('<a href="/cita">Reservar cita</a>');
    assert.deepEqual(bookingInfo(spanish, pageUrls(spanish, base), base), { hasBooking: true, bookingProvider: null });
    const none = page('<a href="/about">About us</a><a href="https://facebook.com/salon">Facebook</a>');
    assert.deepEqual(bookingInfo(none, pageUrls(none, base), base), { hasBooking: false, bookingProvider: null });
});

test('social links: profiles kept, share buttons ignored', () => {
    const $ = page('<a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a><a href="https://www.facebook.com/joesplumbing/">FB</a><a href="https://instagram.com/joes_plumbing">IG</a>');
    assert.deepEqual(socialLinks(pageUrls($, 'https://joes.example/')), { facebook: 'https://www.facebook.com/joesplumbing', instagram: 'https://instagram.com/joes_plumbing' });
});

test('contact page link in several languages, same site only', () => {
    assert.equal(contactPageUrl(page('<a href="/kontakt">Kontakt</a>'), 'https://friseur.example/'), 'https://friseur.example/kontakt');
    assert.equal(contactPageUrl(page('<a href="/wasiliana-nasi">Wasiliana Nasi</a>'), 'https://salon.co.ke/'), 'https://salon.co.ke/wasiliana-nasi');
    assert.equal(contactPageUrl(page('<a href="https://other.example/contact">Contact</a>'), 'https://salon.example/'), null);
});

test('appointment businesses, without matching look-alike words', () => {
    assert.equal(isAppointmentBusiness('Hair salon', 'Glam Studio'), true);
    assert.equal(isAppointmentBusiness('Peluquería', 'Estilo'), true);
    assert.equal(isAppointmentBusiness('Day spa', ''), true);
    assert.equal(isAppointmentBusiness('Dentist', 'Austin Smiles'), true);
    assert.equal(isAppointmentBusiness('Spanish restaurant', 'Casa Pepe'), false);
    assert.equal(isAppointmentBusiness('Plumber', "Brown's Plumbing"), false);
    assert.equal(isAppointmentBusiness('Barbecue restaurant', 'Smoky'), false);
});

test('regressions from the first real run', () => {
    // WordPress bundles jQuery 3.7.1: that ?ver= is jQuery's version, not WordPress's.
    assert.equal(wordpressVersion('', '<script src="/wp-includes/js/jquery/jquery.min.js?ver=3.7.1"></script>'), null);
    assert.equal(wordpressVersion('', '<link href="/wp-includes/css/dist/block-library/style.min.css?ver=6.5.2">'), '6.5.2');
    // Registrar parking page that only redirects to /lander.
    const lander = cheerio.load('<!DOCTYPE html><html><head><script>window.onload=function(){window.location.href="/lander"}</script></head></html>');
    assert.equal(brokenPageReason(lander, lander.html(), visibleText(lander)), 'Domain parked or for sale');
    // German booking label and a Belbo booking link.
    const base = 'https://kiez.example/';
    const belbo = page('<a href="https://kiezschnitt.belbo.com/meinWunschtermin/1724">Wunschtermin online buchen</a>');
    assert.deepEqual(bookingInfo(belbo, pageUrls(belbo, base), base), { hasBooking: true, bookingProvider: 'Belbo' });
    const label = page('<a href="/x">Wunschtermin online buchen</a>');
    assert.equal(bookingInfo(label, pageUrls(label, base), base).hasBooking, true);
    const path = page('<a href="/schedule-online/">Get started</a>');
    assert.equal(bookingInfo(path, pageUrls(path, base), base).hasBooking, true);
    const facebook = page('<a href="https://facebook.com/x">Facebook</a><a href="/ebooks">Our ebooks</a>');
    assert.equal(bookingInfo(facebook, pageUrls(facebook, base), base).hasBooking, false);
});
