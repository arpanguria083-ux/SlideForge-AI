from fastapi import Header, HTTPException


def require_senior(x_user_role: str = Header("junior")):
    if x_user_role != "senior":
        raise HTTPException(
            status_code=403, detail="Senior evaluator role required for this action"
        )
    return x_user_role
