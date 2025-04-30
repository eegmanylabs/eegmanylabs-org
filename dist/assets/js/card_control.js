// Get all the cards and tags on the page
const allCards = document.querySelectorAll("sl-card");
const allTags = document.querySelectorAll(".tag");
const allSelectors = document.querySelectorAll("sl-select")

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
})

/**
 * Adds the tags present on the page to the corresponding select element
 * @param {object} selEl
 */
function add_select_options(selEl) {

    let elTags = Array.from(allTags);
    elTags = elTags.filter((el) => el.classList.contains(selEl.id));
    let tagVals = new Object();
    
    if (selEl.id == "stage") {
        elTags.forEach((el) => (tagVals[el.classList[2]] = el.innerText))

        tagVals = Object.keys(tagVals).sort().reduce(
            (obj, key) => { 
              obj[key] = tagVals[key]; 
              return obj;
            }, 
            {}
          );
    } else {
        elTags.forEach((el) => (tagVals[el.innerText.toLowerCase()] = el.innerText))
    }

    for (const [value, text] of Object.entries(tagVals)) {
        item = document.createElement("sl-option");
        item.value = value;
        item.innerText = text;
        selEl.appendChild(item);
    }
    
}

/**
 * Get values from the select elements and filter cards accordingly
 */
function update_cards() {
    
    search_terms = []; // Empty array first

    // Push the values from each select element to the search_terms array
    allSelectors.forEach(update_search_terms)

    // Filter cards if there are values in the search_terms array
    if (search_terms.length == 0) {
        allCards.forEach(showCard);
    } else {
        allCards.forEach(hideCard);
    }
}

function update_search_terms(el) {
    if (typeof(el.value) ==='string') {
        if (el.value.length > 0) {
            search_terms.push(el.value)
        }
    } else {
        search_terms.push(...el.value)
    }
}

/**
 * Checks whether a card should be hidden based on the contents of a clicked tag.
 * @param {object} el - The card element to be checked 
 */
function hideCard(el) {
    // Get all tags within card
    childTags = Array.from(el.classList);
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
