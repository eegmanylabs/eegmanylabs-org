// Get all the cards and tags on the page
const allCards = document.querySelectorAll("sl-card");
const allTags = document.querySelectorAll("sl-tag");
const allSelectors = document.querySelectorAll("sl-select")
const allSections = document.querySelectorAll("section")

const NfrontPageCards = 4;

let search_terms;

window.addEventListener("load", () => {
    // Setup select elements
    if (allTags.length > 0) {
        allSelectors.forEach((el) => {
            el.addEventListener('sl-change', update_cards);
            add_select_options(el);
        })
        document.querySelector("div.select-container").style = "display:block"
    }

    // Sample cards for front page
    allSections.forEach((el) => sample_cards(el))
})

/**
 * Adds the tags present on the page to the corresponding select element
 * @param {object} selEl
 */
function add_select_options(selEl) {

    let tagVals = new Set();
    let elTags = Array.from(allTags);
    
    elTags = elTags.filter((el) => el.classList.contains(selEl.className));
    
    elTags.forEach((el) => tagVals.add(el.innerText))

    for (let tagVal of tagVals) {
        item = document.createElement("sl-option");
        item.value = tagVal;
        item.innerText = tagVal;
        selEl.appendChild(item);
    }
}

/**
 * Get values from the select elements and filter cards accordingly
 */
function update_cards() {
    
    search_terms = []; // Empty array first

    // Push the values from each select element to the search_terms array
    allSelectors.forEach((el) => (search_terms.push(...el.value)))

    // Filter cards if there are values in the search_terms array
    if (search_terms.length == 0) {
        allCards.forEach(showCard);
    } else {
        allCards.forEach(hideCard);
    }
}

/**
 * Checks whether a card should be hidden based on the contents of a clicked tag.
 * @param {object} el - The card element to be checked 
 */
function hideCard(el) {
    // Get all tags within card
    childTags = Array.from(el.querySelectorAll("sl-tag")).map((el) => (el.innerText));
    // See if any of those tags match the text of the clicked tag
    contains = search_terms.every((term) => (childTags.includes(term)))
    
    // If yes then show, if no then hide
    if (contains){
        showCard(el);
    } else {
        el.style.display = 'none';
    }
}

/**
 * Show a card element
 * @param {object} el - The card element to be shown 
 */
function showCard(el) {
    el.style.display = '';
}

/**
 * Display a random sample of cards for a section on the front page
 * @param {object} el - Section element contaning cards
 */
function sample_cards(el) {
    let cards = Array.from(el.querySelectorAll(".preview"))
    shuffleArray(cards)

    cards.slice(0, NfrontPageCards).forEach((el) => el.style = "display: grid")
}

/**
 * Shuffles an array
 * @param {array} array 
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i >= 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}
