// GENERATED from the kernel's own answer — do not edit.
//
// 'scripts/gen-vocabulary.mjs' asked the built artifact for vocabulary()
// and wrote the answer here, because the client's tables load before any
// kernel does. A hand-edited word here is a word the kernel did not say;
// regenerate instead. The artifact suite fails this file against the live
// answer, and boot refuses to run when the two disagree.

export const VOCABULARY = {
    "errors": [
        "duplicate_id",
        "unknown_element",
        "unresizable",
        "patch_resizes_polyline",
        "zero_area_image",
        "zero_area_text",
        "position_out_of_range",
        "order",
        "empty_group",
        "empty_clipboard",
        "copy_count_mismatch",
        "bad_element_id",
        "not_a_text",
        "not_a_frame",
        "unknown_vertex",
        "no_such_segment",
        "not_a_turning_arrow",
        "too_few_vertices",
        "not_a_container",
        "already_has_bound_text",
        "empty_selection",
        "not_an_image",
        "crop_outside_the_bitmap",
        "non_finite"
    ],
    "fontFamilies": [
        {
            "id": 1,
            "name": "NextDraw Hand"
        },
        {
            "id": 2,
            "name": "Helvetica"
        },
        {
            "id": 3,
            "name": "Cascadia"
        },
        {
            "id": 5,
            "name": "NextDraw Script"
        },
        {
            "id": 6,
            "name": "Nunito"
        },
        {
            "id": 7,
            "name": "Lilita One"
        },
        {
            "id": 8,
            "name": "Comic Shanns"
        },
        {
            "id": 9,
            "name": "Liberation Sans"
        },
        {
            "id": 10,
            "name": "Assistant"
        }
    ],
    "hatch": {
        "slant": 0.35,
        "spacing": 6
    },
    "hitKinds": {
        "answers": [
            "handle",
            "body",
            "none",
            "rotate"
        ],
        "handles": [
            "nw",
            "n",
            "ne",
            "w",
            "e",
            "sw",
            "s",
            "se"
        ],
        "records": [
            "polygon",
            "selection",
            "group"
        ]
    },
    "styles": {
        "edges": [
            "round",
            "sharp"
        ],
        "fill": [
            "solid",
            "hachure",
            "cross-hatch",
            "zigzag"
        ],
        "lineWidth": [
            "thin",
            "medium",
            "bold"
        ],
        "roughness": [
            "architect",
            "artist",
            "cartoonist"
        ],
        "stroke": [
            "solid",
            "dashed",
            "dotted"
        ]
    }
};

export const STYLE_TOKENS = VOCABULARY.styles;
export const CHROME_RECORD_KINDS = VOCABULARY.hitKinds.records;
export const HANDLE_NAMES = VOCABULARY.hitKinds.handles;
export const HIT_ANSWER_KINDS = VOCABULARY.hitKinds.answers;
export const FONT_FAMILIES = VOCABULARY.fontFamilies;
export const WIRE_ERRORS = VOCABULARY.errors;
export const HATCH = VOCABULARY.hatch;
