// @flow
/**
 * This component, given a single DOMHighlight, draws highlight rectangles in
 * the same absolute position as the highlighted content, as computed via
 * `getClientRects`. On hover, renders a "Remove Highlight" tooltip that, when
 * clicked, fires a callback to remove this highlight.
 *
 * TODO(mdr): Many things can affect the correct positioning of highlighting,
 *     and this component does not attempt to anticipate them. If we start
 *     using this highlighting library on content with a more dynamic layout,
 *     we should add a hook to allow the parent to `forceUpdate` the
 *     `HighlightRenderer`.
 */
const React = require("react");
const {StyleSheet, css} = require("aphrodite");

const {getClientRectsForTextInRange, getRelativePosition, getRelativeRect} =
    require("./util.js");
const HighlightTooltip = require("./highlight-tooltip.jsx");

/* global i18n */

import type {DOMHighlight, Position, Rect, ZIndexes} from "./types.js";

type HighlightRendererProps = {
    // Whether this highlight is user-editable. If false, the highlight is
    // read-only.
    editable: boolean,

    // The DOMHighlight to render.
    highlight: DOMHighlight,

    // A unique key corresponding to the given `highlight`.
    highlightKey: string,

    // The mouse's current position, relative to the viewport.
    mouseClientPosition: ?Position,

    // This component's `offsetParent` element, which is the nearest ancestor
    // with `position: relative`. This will enable us to choose the correct
    // CSS coordinates to align highlights and tooltips with the target
    // content.
    offsetParent: Element,

    // A callback indicating that the user would like to remove this highlight.
    // Called with the highlight's key.
    onRemoveHighlight: (key: string) => mixed,

    // The z-indexes to use when rendering tooltips above content, and
    // highlights below content.
    zIndexes: ZIndexes,
};

type HighlightRendererState = {
    // The set of rectangles that cover this highlight's content, relative to
    // the offset parent. This cache is updated on mount and on changes to
    // the `highlight` and `offsetParent` props.
    //
    // We perform this caching because we need to access the rectangles every
    // time the user's mouse moves, in order to check the hover state, and
    // recomputing them on every mousemove seems like it could be expensive on
    // older devices (though tbf that's just a gut instinct, not the result of
    // testing on older devices).
    //
    // For most caching in highlighting, we take advatange of `PureComponent`,
    // and be mindful of the props we pass in. But this event happens on
    // mousemove, not on receive-props or set-state, so `PureComponent` doesn't
    // protect us from redundant work. We need to do it ourselves :/
    cachedHighlightRects: Rect[],

    // Whether the "Remove Highlight" tooltip is currently hovered. We don't
    // want to remove it while the user's mouse is over it!
    tooltipIsHovered: boolean,
};

class HighlightRenderer extends React.PureComponent {
    props: HighlightRendererProps
    state: HighlightRendererState = {
        cachedHighlightRects: this._computeRects(this.props),
        tooltipIsHovered: false,
    }

    componentWillReceiveProps(nextProps: HighlightRendererProps) {
        if (
            this.props.highlight !== nextProps.highlight ||
            this.props.offsetParent !== nextProps.offsetParent
        ) {
            this.setState({
                cachedHighlightRects: this._computeRects(nextProps),
            });
        }
    }

    /**
     * Compute the set of rectangles that cover the highlighted content, with
     * coordinates relative to the offset parent. That way, we can use them
     * for CSS positioning.
     */
    _computeRects(props: HighlightRendererProps): Rect[] {
        const {highlight, offsetParent} = props;

        // Get the set of rectangles that covers the range's text, relative to
        // the offset parent.
        const clientRects = getClientRectsForTextInRange(highlight.domRange);
        const offsetParentRect = offsetParent.getBoundingClientRect();
        const relativeRects =
            clientRects.map(rect => getRelativeRect(rect, offsetParentRect));

        return relativeRects;
    }

    _handleRemoveHighlight = () => {
        this.props.onRemoveHighlight(this.props.highlightKey);
    }

    _handleTooltipMouseEnter = () => {
        this.setState({tooltipIsHovered: true});
    }

    _handleTooltipMouseLeave = () => {
        this.setState({tooltipIsHovered: false});
    }

    /**
     * Return whether the given mouse position (coordinates relative to the
     * viewport) is hovering over this highlight.
     */
    _highlightIsHovered(mouseClientPosition: ?Position): boolean {
        if (!mouseClientPosition) {
            return false;
        }

        const {offsetParent} = this.props;
        const {cachedHighlightRects} = this.state;

        // Convert the client-relative mouse coordinates to be relative to the
        // offset parent. That way, we can compare them to the cached highlight
        // rectangles.
        const offsetParentRect = offsetParent.getBoundingClientRect();
        const mouseOffsetPosition =
            getRelativePosition(mouseClientPosition, offsetParentRect);

        return cachedHighlightRects.some(rect =>
            this._rectIsHovered(rect, mouseOffsetPosition));
    }

    /**
     * Return whether the given mouse position (coordinates relative to this
     * component's offset parent) is hovering over the given rectangle
     * (coordinates also relative to this component's offset parent).
     */
    _rectIsHovered(rect: Rect, mouseOffsetPosition: Position): boolean {
        const positionWithinRect =
            getRelativePosition(mouseOffsetPosition, rect);

        return 0 <= positionWithinRect.left &&
            positionWithinRect.left < rect.width &&
            0 <= positionWithinRect.top &&
            positionWithinRect.top < rect.height;
    }

    /**
     * Return whether the "Remove highlight" tooltip should be visible.
     */
    _shouldShowTooltip(): boolean {
        // If the highlight is not editable, hide the tooltip.
        if (!this.props.editable) {
            return false;
        }

        // If the tooltip is hovered, continue to show it, even if the
        // highlight is no longer hovered.
        if (this.state.tooltipIsHovered) {
            return true;
        }

        // If the highlight is hovered, show the tooltip.
        if (this._highlightIsHovered(this.props.mouseClientPosition)) {
            return true;
        }

        // Otherwise, hide the tooltip.
        return false;
    }

    render() {
        const rects = this.state.cachedHighlightRects;

        return <div>
            <div>
                {rects.map((rect, index) =>
                    <div
                        key={index}
                        className={css(styles.highlightRect)}
                        style={{
                            // NOTE(mdr): We apply `position: absolute` here
                            //     rather than in Aphrodite styles, because
                            //     Aphrodite styles are delayed. If this
                            //     element temporarily has `position: static`,
                            //     then it'll displace the content, and other
                            //     highlights rendering during this update will
                            //     measure the displaced content instead, oops!
                            position: "absolute",
                            width: rect.width,
                            height: rect.height,
                            top: rect.top,
                            left: rect.left,
                            zIndex: this.props.zIndexes.belowContent,
                        }}
                    />
                )}
            </div>
            {this._shouldShowTooltip() && <HighlightTooltip
                label={i18n._("Remove highlight")}
                onClick={this._handleRemoveHighlight}
                onMouseEnter={this._handleTooltipMouseEnter}
                onMouseLeave={this._handleTooltipMouseLeave}

                focusNode={this.props.highlight.domRange.endContainer}
                focusOffset={this.props.highlight.domRange.endOffset}
                offsetParent={this.props.offsetParent}
                zIndex={this.props.zIndexes.aboveContent}
            />}
        </div>;
    }
}

const styles = StyleSheet.create({
    highlightRect: {
        background: "#fffabe", // highlighter yellow :)
    },
});

module.exports = HighlightRenderer;
