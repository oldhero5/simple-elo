"""Errors whose message is meant for the person using the app."""


class RatingError(Exception):
    """A request the app understood but cannot carry out, said in plain words.

    The API turns this, and only this, into a 400 with the message. Anything
    else that goes wrong is logged and answered with a generic 500, so library
    messages (pydantic, numpy, DuckDB) never reach the client. It deliberately
    does not subclass ValueError, which those libraries also raise.
    """
