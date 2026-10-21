import type { Request, Response } from "express"
import { catchAsync } from "../../utils/catchAsync"
import { sendResponse } from "../../utils/sendResponse"
import  httpStatus from "http-status"

const loginUser = catchAsync(async (req: Request, res: Response) => {
    sendResponse(res, {
        statusCode: httpStatus.CREATED,
        success: true,
        message: 'Patient registered successfully',
        data : null
            
    })
})

export const authController = {
    loginUser
}