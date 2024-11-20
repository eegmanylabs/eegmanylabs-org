// Get all the cards and tags on the page
const allCards = document.querySelectorAll("sl-card");
const allTags = document.querySelectorAll("sl-tag");
const dropDown = document.querySelector("sl-dropdown");
const ddMenu = document.querySelector("sl-menu");

let search_term;

if (allTags.length > 0) {
    let tags = new Set();

    for (node of allTags) {
        tags.add(node.innerText);
    }

    for (let tag of tags) {
        item = document.createElement("sl-menu-item");
        item.value = tag;
        item.innerText = tag;
        ddMenu.appendChild(item);
    }
    dropDown.style.display = '';
}

dropDown.addEventListener('sl-select', event => {
    const selectedItem = event.detail.item;
    search_term = selectedItem.value;
    if (search_term === "none"){
        allCards.forEach(showCard);
    } else {
        allCards.forEach(hideCard);
    }
});

/**
 * Checks whether a card should be hidden based on the contents of a clicked tag.
 * @param {object} el - The card element to be checked 
 */
function hideCard(el) {
    // Get all tags within card
    childTags = Array.from(el.querySelectorAll("sl-tag"));
    // See if any of those tags match the text of the clicked tag
    contains = childTags.some((Cel) => (Cel.innerText === search_term));
    
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